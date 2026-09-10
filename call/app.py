import sqlite3
from datetime import datetime

from flask import Flask, g, jsonify, render_template, request
from werkzeug.middleware.proxy_fix import ProxyFix

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
    return render_template("index.html", company_name=config.COMPANY_NAME)


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
        }
    )


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


def _send_bulk(to_numbers, message):
    """Send one message to every number in to_numbers. The android provider
    batches all recipients into a single gateway request (one message,
    fanned out server-side). dongle/smpp have no native batch call, so for
    those this sends once per number and aggregates the results.
    Returns (success, detail) - success is True only if every send succeeded.
    """
    if config.SMS_PROVIDER == "android":
        return android_sms_gateway.send_sms(to_numbers, message)

    providers = {
        "dongle": (sms_gateway.send_sms, sms_gateway.ModemError),
        "smpp": (smpp_gateway.send_sms, smpp_gateway.SmppError),
    }
    send_fn, error_cls = providers.get(config.SMS_PROVIDER, providers["dongle"])

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


@app.route("/api/sms", methods=["POST"])
def send_sms():
    data = request.get_json(force=True, silent=True) or {}
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
        success, detail = _send_bulk(to_numbers, message)
        status = "sent" if success else "failed"
    except (android_sms_gateway.AndroidGatewayError, sms_gateway.ModemError, smpp_gateway.SmppError) as e:
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


if __name__ == "__main__":
    # host=0.0.0.0 so other agents on the LAN can open the softphone too.
    # Browsers require HTTPS (or localhost) to grant microphone access, so
    # for real deployment run this behind TLS (see README.md).
    app.run(host="0.0.0.0", port=5000, debug=True)
