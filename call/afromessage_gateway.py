"""Send SMS through AfroMessage (https://afromessage.com), an Ethiopian SMS
aggregator — the way to get a *custom* sender id, unlike the android/dongle
providers which always show the registered phone/SIM's own number.

AfroMessage's public API (https://api.afromessage.com/api/send) sends to one
recipient per request; there's no server-side bulk fan-out, so send_sms()
here is called once per number from app.py's _send_bulk loop, the same way
sms_gateway.py and smpp_gateway.py are.

Response shape (per AfroMessage's API): {"acknowledge": "success", ...} on
success, {"acknowledge": "error", "response": "<reason>"} on failure.
"""

import re

import requests

import config


class AfroMessageError(Exception):
    pass


def _to_local_format(to_number):
    """AfroMessage expects the number without a leading '+' (e.g.
    251911234567). Callers throughout this app pass E.164 (+251...) or
    Ethiopian local format (0911234567) - normalize both to that one shape.
    """
    digits = re.sub(r"\D", "", to_number)
    if digits.startswith("0") and len(digits) == 10:
        return f"251{digits[1:]}"
    return digits


def send_sms(to_number, message):
    """Send a single SMS via AfroMessage. Returns (success, detail) to match
    the (number, message) -> (ok, detail) signature app.py's _send_bulk loop
    uses for the dongle/smpp providers.
    """
    if not config.AFROMESSAGE_API_KEY:
        raise AfroMessageError("AFROMESSAGE_API_KEY is not set")
    if not to_number or not message:
        raise AfroMessageError("A destination number and a message are required")

    payload = {"to": _to_local_format(to_number), "message": message}
    if config.AFROMESSAGE_IDENTIFIER:
        payload["sender"] = config.AFROMESSAGE_IDENTIFIER
    if config.AFROMESSAGE_FROM:
        payload["from"] = config.AFROMESSAGE_FROM

    try:
        resp = requests.post(
            config.AFROMESSAGE_API_URL,
            json=payload,
            headers={"Authorization": f"Bearer {config.AFROMESSAGE_API_KEY}"},
            timeout=15,
        )
    except requests.RequestException as e:
        raise AfroMessageError(f"Could not reach AfroMessage: {e}")

    try:
        data = resp.json()
    except ValueError:
        raise AfroMessageError(f"AfroMessage returned HTTP {resp.status_code} (non-JSON): {resp.text[:300]}")

    if resp.status_code != 200 or data.get("acknowledge") != "success":
        raise AfroMessageError(f"AfroMessage rejected the message: {data.get('response') or data}")

    return True, str(data.get("response"))
