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

# Which SMS channel /api/sms should actually use: "dongle" (sms_gateway.py,
# USB AT-command modem), "android" (android_sms_gateway.py, a phone running
# capcom6/android-sms-gateway), or "smpp" (smpp_gateway.py, a real
# carrier/aggregator account — or the local simulator for testing).
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

# --- Android SMS Gateway (capcom6/android-sms-gateway, local HTTP mode) --
# Install the app on any spare Android phone with a SIM, enable "Local
# Server", and put its local IP + the username/password it shows here.
# The sender the customer sees will be that phone's own SIM number.
ANDROID_SMS_GATEWAY_URL = os.environ.get("ANDROID_SMS_GATEWAY_URL", "")
ANDROID_SMS_GATEWAY_USERNAME = os.environ.get("ANDROID_SMS_GATEWAY_USERNAME", "")
ANDROID_SMS_GATEWAY_PASSWORD = os.environ.get("ANDROID_SMS_GATEWAY_PASSWORD", "")

# Flask
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me")
DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "calls.db"))
