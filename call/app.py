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
            "smsComPort": config.SMS_COM_PORT,
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
# API: SMS (USB GSM/3G dongle, plain AT commands)
# ---------------------------------------------------------------------------
@app.route("/api/sms/ports", methods=["GET"])
def sms_ports():
    """List serial ports Windows can see, to help pick the modem's AT port."""
    return jsonify(sms_gateway.list_serial_ports())


@app.route("/api/sms/test", methods=["POST"])
def sms_test_port():
    """Ping a specific port with a plain AT command to check it answers OK."""
    data = request.get_json(force=True, silent=True) or {}
    port = data.get("port") or config.SMS_COM_PORT
    return jsonify(sms_gateway.test_port(port))


@app.route("/api/sms", methods=["GET"])
def list_sms():
    db = get_db()
    rows = db.execute("SELECT * FROM sms_log ORDER BY id DESC LIMIT 100").fetchall()
    return jsonify([dict(row) for row in rows])


@app.route("/api/sms", methods=["POST"])
def send_sms():
    data = request.get_json(force=True, silent=True) or {}
    to_number = (data.get("to") or "").strip()
    message = (data.get("message") or "").strip()

    if not to_number or not message:
        return jsonify({"error": "to and message are required"}), 400

    providers = {
        "dongle": (sms_gateway.send_sms, sms_gateway.ModemError),
        "android": (android_sms_gateway.send_sms, android_sms_gateway.AndroidGatewayError),
        "smpp": (smpp_gateway.send_sms, smpp_gateway.SmppError),
    }
    send_fn, error_cls = providers.get(config.SMS_PROVIDER, providers["dongle"])

    db = get_db()
    try:
        success, detail = send_fn(to_number, message)
        status = "sent" if success else "failed"
    except error_cls as e:
        success = False
        status = "failed"
        detail = str(e)

    cur = db.execute(
        """
        INSERT INTO sms_log (to_number, message, status, detail, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (to_number, message, status, detail, datetime.utcnow().isoformat()),
    )
    db.commit()

    return jsonify({"id": cur.lastrowid, "status": status, "detail": detail}), (201 if success else 502)


if __name__ == "__main__":
    # host=0.0.0.0 so other agents on the LAN can open the softphone too.
    # Browsers require HTTPS (or localhost) to grant microphone access, so
    # for real deployment run this behind TLS (see README.md).
    app.run(host="0.0.0.0", port=5000, debug=True)
