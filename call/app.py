import json
import sqlite3
import uuid
from datetime import datetime

from flask import Flask, g, jsonify, render_template, request
from werkzeug.middleware.proxy_fix import ProxyFix

import afromessage_gateway
import android_sms_gateway
import config
import sms_gateway
import smpp_gateway

app = Flask(__name__)
app.config["SECRET_KEY"] = config.SECRET_KEY

# Behind Caddy at https://ethiotelecom.zmichael.click/call/ — trust the
# X-Forwarded-* headers it sets so url_for() generates correct https:// and
# /call-prefixed URLs instead of assuming it's served at the root.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)


# ---------------------------------------------------------------------------
# Database helpers (SQLite call log)
# ---------------------------------------------------------------------------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(config.DATABASE_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(config.DATABASE_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            direction TEXT NOT NULL,       -- 'inbound' or 'outbound'
            peer TEXT NOT NULL,            -- remote number / extension
            status TEXT NOT NULL,          -- 'answered', 'missed', 'rejected', 'failed'
            started_at TEXT NOT NULL,
            ended_at TEXT,
            duration_seconds INTEGER DEFAULT 0
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sms_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            to_number TEXT NOT NULL,
            message TEXT NOT NULL,
            status TEXT NOT NULL,          -- 'sent' or 'failed'
            detail TEXT,                   -- raw modem response, useful for debugging
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS bulk_sms_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id TEXT NOT NULL,        -- groups every recipient from one "Send bulk SMS" click
            phone TEXT NOT NULL,
            message TEXT NOT NULL,
            status TEXT NOT NULL,          -- 'sent' or 'failed' - AfroMessage accepting the
                                            -- message, not a carrier delivery receipt
            detail TEXT,                   -- AfroMessage's raw per-recipient response
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


# Run unconditionally at import time (not just under `if __name__ ==
# "__main__"`) so the tables exist no matter how the server is started
# (python app.py, flask run, gunicorn, etc.).
init_db()


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template(
        "index.html",
        company_name=config.COMPANY_NAME,
        public_sms_api_url=config.PUBLIC_SMS_API_URL,
        public_sms_mobile_url=config.PUBLIC_SMS_MOBILE_URL,
        android_app_url=config.ANDROID_APP_URL,
    )


# ---------------------------------------------------------------------------
# API: SIP registration config consumed by the browser softphone
# ---------------------------------------------------------------------------
@app.route("/api/config")
def api_config():
    return jsonify(
        {
            "wsUrl": config.SIP_WS_URL,
            "sipUri": f"sip:{config.SIP_USERNAME}@{config.SIP_DOMAIN}",
            "authUser": config.SIP_USERNAME,
            "password": config.SIP_PASSWORD,
            "displayName": config.SIP_DISPLAY_NAME,
            "companyName": config.COMPANY_NAME,
            "server": config.SIP_SERVER,
            "smsSenderLabel": config.SMS_SENDER_LABEL,
            "smsBulkMaxRecipients": config.SMS_BULK_MAX_RECIPIENTS,
        }
    )


# ---------------------------------------------------------------------------
# API: saved contacts (Bulk SMS tab's "saved contacts" picker)
# ---------------------------------------------------------------------------
@app.route("/api/contacts", methods=["GET"])
def list_contacts():
    try:
        with open(config.CONTACTS_FILE, "r", encoding="utf-8") as f:
            contacts = json.load(f)
    except (FileNotFoundError, ValueError):
        contacts = []
    return jsonify(contacts)


# ---------------------------------------------------------------------------
# API: call log
# ---------------------------------------------------------------------------
@app.route("/api/calls", methods=["GET"])
def list_calls():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM calls ORDER BY id DESC LIMIT 100"
    ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.route("/api/calls", methods=["POST"])
def log_call():
    data = request.get_json(force=True, silent=True) or {}
    direction = data.get("direction")
    peer = data.get("peer")
    status = data.get("status")
    duration_seconds = int(data.get("durationSeconds") or 0)

    if direction not in ("inbound", "outbound") or not peer or not status:
        return jsonify({"error": "direction, peer and status are required"}), 400

    started_at = data.get("startedAt") or datetime.utcnow().isoformat()
    ended_at = datetime.utcnow().isoformat()

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO calls (direction, peer, status, started_at, ended_at, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (direction, peer, status, started_at, ended_at, duration_seconds),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid}), 201


# ---------------------------------------------------------------------------
# API: SMS
# ---------------------------------------------------------------------------
@app.route("/api/sms", methods=["GET"])
def list_sms():
    db = get_db()
    rows = db.execute("SELECT * FROM sms_log ORDER BY id DESC LIMIT 100").fetchall()
    return jsonify([dict(row) for row in rows])


def _send_one_per_number(to_numbers, message, send_fn, error_cls):
    """Call send_fn(number, message) once per number and aggregate the
    results. Returns (success, detail) - success is True only if every
    send succeeded.
    """
    results = []
    all_ok = True
    for number in to_numbers:
        try:
            ok, detail = send_fn(number, message)
        except error_cls as e:
            ok, detail = False, str(e)
        all_ok = all_ok and ok
        results.append(f"{number}: {'OK' if ok else 'FAILED'} - {detail}")
    return all_ok, "; ".join(results)


def _send_bulk(to_numbers, message):
    """Single SMS tab only (/api/sms below) - driven by SMS_PROVIDER
    ("android", "dongle" or "smpp"). Deliberately never routes to
    AfroMessage: Bulk SMS (send_bulk_sms() / /api/bulk-sms) always uses
    AfroMessage on its own, regardless of this setting, so the two tabs
    can use different senders without one setting affecting the other.
    """
    if config.SMS_PROVIDER == "android":
        return android_sms_gateway.send_sms(to_numbers, message)

    providers = {
        "dongle": (sms_gateway.send_sms, sms_gateway.ModemError),
        "smpp": (smpp_gateway.send_sms, smpp_gateway.SmppError),
    }
    send_fn, error_cls = providers.get(config.SMS_PROVIDER, providers["dongle"])
    return _send_one_per_number(to_numbers, message, send_fn, error_cls)


def _handle_sms_send(data, sender_fn):
    """Shared validation/logging for both /api/sms and /api/bulk-sms.
    sender_fn(to_numbers, message) -> (success, detail).
    """
    to_field = data.get("to")
    to_numbers = to_field if isinstance(to_field, list) else [to_field]
    to_numbers = [n.strip() for n in to_numbers if n and n.strip()]
    message = (data.get("message") or "").strip()

    if not to_numbers or not message:
        return jsonify({"error": "At least one recipient and a message are required"}), 400
    if len(to_numbers) > config.SMS_BULK_MAX_RECIPIENTS:
        return jsonify({
            "error": f"Too many recipients ({len(to_numbers)}). Max is {config.SMS_BULK_MAX_RECIPIENTS} per send."
        }), 400

    db = get_db()
    try:
        success, detail = sender_fn(to_numbers, message)
        status = "sent" if success else "failed"
    except (
        android_sms_gateway.AndroidGatewayError,
        sms_gateway.ModemError,
        smpp_gateway.SmppError,
        afromessage_gateway.AfroMessageError,
    ) as e:
        success = False
        status = "failed"
        detail = str(e)

    cur = db.execute(
        """
        INSERT INTO sms_log (to_number, message, status, detail, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (", ".join(to_numbers), message, status, detail, datetime.utcnow().isoformat()),
    )
    db.commit()

    return jsonify({
        "id": cur.lastrowid,
        "status": status,
        "detail": detail,
        "recipientCount": len(to_numbers),
    }), (201 if success else 502)


@app.route("/api/sms", methods=["POST"])
def send_sms():
    """Single/quick-multi SMS tab. Never uses AfroMessage - see _send_bulk."""
    data = request.get_json(force=True, silent=True) or {}
    return _handle_sms_send(data, _send_bulk)


@app.route("/api/bulk-sms", methods=["POST"])
def send_bulk_sms():
    """Bulk SMS tab. Always uses AfroMessage, regardless of SMS_PROVIDER.
    Unlike /api/sms, this logs one row per recipient (bulk_sms_log, not
    sms_log) so the Bulk SMS report can count sends per job. A "Send bulk
    SMS" click may call this once per batch (SMS_BULK_MAX_RECIPIENTS cap) -
    the client passes the same batchId on every call so all of them are
    counted as one job in the report.
    """
    data = request.get_json(force=True, silent=True) or {}
    to_field = data.get("to")
    to_numbers = to_field if isinstance(to_field, list) else [to_field]
    to_numbers = [n.strip() for n in to_numbers if n and n.strip()]
    message = (data.get("message") or "").strip()
    batch_id = (data.get("batchId") or "").strip() or uuid.uuid4().hex

    if not to_numbers or not message:
        return jsonify({"error": "At least one recipient and a message are required"}), 400
    if len(to_numbers) > config.SMS_BULK_MAX_RECIPIENTS:
        return jsonify({
            "error": f"Too many recipients ({len(to_numbers)}). Max is {config.SMS_BULK_MAX_RECIPIENTS} per send."
        }), 400

    db = get_db()
    now = datetime.utcnow().isoformat()
    sent_count = 0
    for number in to_numbers:
        try:
            ok, detail = afromessage_gateway.send_sms(number, message)
        except afromessage_gateway.AfroMessageError as e:
            ok, detail = False, str(e)
        if ok:
            sent_count += 1
        db.execute(
            """
            INSERT INTO bulk_sms_log (batch_id, phone, message, status, detail, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (batch_id, number, message, "sent" if ok else "failed", detail, now),
        )
    db.commit()

    failed_count = len(to_numbers) - sent_count
    http_status = 201 if failed_count == 0 else (502 if sent_count == 0 else 207)
    return jsonify({
        "batchId": batch_id,
        "recipientCount": len(to_numbers),
        "sentCount": sent_count,
        "failedCount": failed_count,
    }), http_status


# ---------------------------------------------------------------------------
# API: Bulk SMS report (per-recipient log + running totals)
# ---------------------------------------------------------------------------
@app.route("/api/bulk-sms/log", methods=["GET"])
def list_bulk_sms_log():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM bulk_sms_log ORDER BY id DESC LIMIT 500"
    ).fetchall()
    totals = db.execute(
        """
        SELECT
            COUNT(*) AS recipients,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            COUNT(DISTINCT batch_id) AS batches
        FROM bulk_sms_log
        """
    ).fetchone()
    return jsonify({
        "rows": [dict(row) for row in rows],
        "totals": dict(totals) if totals and totals["recipients"] else
            {"recipients": 0, "sent": 0, "failed": 0, "batches": 0},
    })


if __name__ == "__main__":
    # host=0.0.0.0 so other agents on the LAN can open the softphone too.
    # Browsers require HTTPS (or localhost) to grant microphone access, so
    # for real deployment run this behind TLS (see README.md).
    app.run(host="0.0.0.0", port=5000, debug=True)
