import os

# --- PBX / SIP connection settings ---------------------------------------
# These can be overridden with environment variables of the same name,
# e.g. set SIP_PASSWORD=xxxx before running app.py, instead of editing this
# file directly.

SIP_DOMAIN = os.environ.get("SIP_DOMAIN", "")
SIP_SERVER = os.environ.get("SIP_SERVER", "")
SIP_WS_URL = os.environ.get("SIP_WS_URL", "")
SIP_USERNAME = os.environ.get("SIP_USERNAME", "")
SIP_PASSWORD = os.environ.get("SIP_PASSWORD", "")
SIP_DISPLAY_NAME = os.environ.get("SIP_DISPLAY_NAME", "Gebeta Technology Trading plc")

COMPANY_NAME = os.environ.get("COMPANY_NAME", "Gebeta Technology Trading plc")

# --- Call hunting across multiple agent seats ------------------------------
# Each seat is its own SIP extension on the same PBX (SIP_DOMAIN/SIP_SERVER/
# SIP_WS_URL above) - a device picks one seat to register as (see the Agent
# picker in the UI). Seat 1 reuses SIP_USERNAME/PASSWORD above so this keeps
# working with just the one extension that already exists; seats 2-4 only
# appear once their own AGENT2/3/4_SIP_* env vars are filled in (e.g. once
# the PBX admin provisions more extensions), so nothing breaks today.
def _agent_seat(seat_id, label, username, password, display_name):
    return {
        "id": seat_id,
        "label": label,
        "username": username,
        "password": password,
        "displayName": display_name or label,
    }


AGENT_SEATS = [
    seat
    for seat in [
        _agent_seat("1", "Agent 1", SIP_USERNAME, SIP_PASSWORD, SIP_DISPLAY_NAME),
        _agent_seat(
            "2", "Agent 2",
            os.environ.get("AGENT2_SIP_USERNAME", ""),
            os.environ.get("AGENT2_SIP_PASSWORD", ""),
            os.environ.get("AGENT2_SIP_DISPLAY_NAME", ""),
        ),
        _agent_seat(
            "3", "Agent 3",
            os.environ.get("AGENT3_SIP_USERNAME", ""),
            os.environ.get("AGENT3_SIP_PASSWORD", ""),
            os.environ.get("AGENT3_SIP_DISPLAY_NAME", ""),
        ),
        _agent_seat(
            "4", "Agent 4",
            os.environ.get("AGENT4_SIP_USERNAME", ""),
            os.environ.get("AGENT4_SIP_PASSWORD", ""),
            os.environ.get("AGENT4_SIP_DISPLAY_NAME", ""),
        ),
    ]
    if seat["username"] and seat["password"]
]

# How long an incoming call rings on one seat before this app gives up on
# that seat and hands the call to the next one in AGENT_SEATS (looping back
# to the first after the last) via a SIP redirect - see static/js/app.js.
# Best-effort: whether telecontactcenter.et actually re-INVITEs the next
# seat on a 302 is outside our control to verify from here; if it doesn't,
# the call just stops ringing on this seat and falls to whatever the PBX's
# own no-answer handling does.
CALL_HUNT_TIMEOUT_SECONDS = int(os.environ.get("CALL_HUNT_TIMEOUT_SECONDS", "20"))

# Which SMS channel the single/quick-multi SMS tab (/api/sms) uses:
# "dongle" (sms_gateway.py, USB AT-command modem), "android"
# (android_sms_gateway.py, a phone running capcom6/android-sms-gateway), or
# "smpp" (smpp_gateway.py, a real carrier/aggregator account — or the local
# simulator for testing). The Bulk SMS tab (/api/bulk-sms) is separate and
# always uses AfroMessage below, regardless of this setting - "afromessage"
# is not a valid value here.
SMS_PROVIDER = os.environ.get("SMS_PROVIDER", "android")

# --- SMS (USB GSM/3G dongle) settings ------------------------------------
# SMS_COM_PORT must match the AT-command interface exposed by the dongle
# (check Windows Device Manager > Ports (COM & LPT) — a single USB dongle
# usually exposes 2-4 COM ports; only one of them accepts AT commands).
# Use GET /api/sms/ports to list what's available, and POST /api/sms/test
# to check which one actually answers "AT" with "OK".
SMS_COM_PORT = os.environ.get("SMS_COM_PORT", "COM5")
SMS_BAUDRATE = int(os.environ.get("SMS_BAUDRATE", "115200"))
SMS_PIN = os.environ.get("SMS_PIN", "")  # SIM PIN, leave blank if the SIM has no PIN lock
SMS_SENDER_LABEL = os.environ.get("SMS_SENDER_LABEL", "8840")

# --- SMPP (real carrier/aggregator connection) ---------------------------
# Point these at the local test simulator (smpp_sim_server.py) by default.
# Once you have a real SMPP account (from Ethio Telecom or a local
# aggregator like Afromessage/Geez SMS), just change these values — the
# client code in smpp_gateway.py doesn't need to change.
SMPP_HOST = os.environ.get("SMPP_HOST", "127.0.0.1")
SMPP_PORT = int(os.environ.get("SMPP_PORT", "2775"))
SMPP_SYSTEM_ID = os.environ.get("SMPP_SYSTEM_ID", "test")
SMPP_PASSWORD = os.environ.get("SMPP_PASSWORD", "test")
SMPP_SOURCE_ADDR = os.environ.get("SMPP_SOURCE_ADDR", SMS_SENDER_LABEL)

# --- Android SMS Gateway (our private sms-gateway-server, see
# sms-gateway-server/) --------------------------------------------------
# ANDROID_SMS_GATEWAY_URL is that server's 3rdparty REST API base, e.g.
# https://<domain>/sms-api/3rdparty/v1. USERNAME/PASSWORD are the account
# login issued during device registration (see DEPLOY.md), sent as HTTP
# Basic Auth. The sender the customer sees is the registered phone's own
# SIM number.
ANDROID_SMS_GATEWAY_URL = os.environ.get("ANDROID_SMS_GATEWAY_URL", "")
ANDROID_SMS_GATEWAY_USERNAME = os.environ.get("ANDROID_SMS_GATEWAY_USERNAME", "")
ANDROID_SMS_GATEWAY_PASSWORD = os.environ.get("ANDROID_SMS_GATEWAY_PASSWORD", "")

# --- AfroMessage (https://afromessage.com) ---------------------------------
# An Ethiopian SMS aggregator — get AFROMESSAGE_API_KEY (a Bearer token)
# from your AfroMessage dashboard under API Keys.
AFROMESSAGE_API_URL = os.environ.get("AFROMESSAGE_API_URL", "https://api.afromessage.com/api/send")
AFROMESSAGE_API_KEY = os.environ.get("AFROMESSAGE_API_KEY", "")
# The registered Sender ID/name recipients see (AfroMessage's "sender" param
# — e.g. "Gebeta Tech", "CityBird", "BahirDar").
AFROMESSAGE_IDENTIFIER = os.environ.get("AFROMESSAGE_IDENTIFIER", "")
# Optional "from" id (AfroMessage's "from" param) some multi-sender plans
# need alongside AFROMESSAGE_IDENTIFIER — leave blank if your plan only
# uses the one sender identifier above.
AFROMESSAGE_FROM = os.environ.get("AFROMESSAGE_FROM", "")

# Saved contacts list for the Bulk SMS tab (data/contacts.json — an array of
# {id, name, phone, valid}), converted from a one-number-per-line text
# export. Not a carrier concern, just where the Bulk SMS UI's "saved
# contacts" picker reads from.
CONTACTS_FILE = os.environ.get(
    "CONTACTS_FILE", os.path.join(os.path.dirname(__file__), "data", "contacts.json")
)

# Public URLs shown in the developer documentation. Keep these free of
# credentials. If the API URL is empty, the browser uses /sms-api on the
# same origin as this console.
PUBLIC_SMS_API_URL = os.environ.get(
    "PUBLIC_SMS_API_URL",
    "https://ethiotelecom.zmichael.click/sms-api/3rdparty/v1",
)
PUBLIC_SMS_MOBILE_URL = os.environ.get(
    "PUBLIC_SMS_MOBILE_URL",
    "https://sms.ethiotelecom.zmichael.click",
)
ANDROID_APP_URL = os.environ.get(
    "ANDROID_APP_URL",
    "https://github.com/capcom6/android-sms-gateway/releases",
)

# Upper bound on recipients in a single bulk send from the SMS tab — a
# sanity cap, not a carrier guarantee. Real-world throughput through one
# phone's SIM is throttled by the carrier; this just stops a mis-paste of
# thousands of numbers from being accepted at all.
SMS_BULK_MAX_RECIPIENTS = int(os.environ.get("SMS_BULK_MAX_RECIPIENTS", "100"))

# Flask
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me")
DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "calls.db"))
