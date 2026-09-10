"""Send SMS through our private self-hosted SMS Gateway server
(sms-gateway-server/, part of this repo — the android-sms-gateway/server
project) rather than talking to a phone's local HTTP API directly. A
registered Android phone running "SMS Gateway for Android"
(https://github.com/capcom6/android-sms-gateway) receives the send request
over FCM push from that server and relays it through its SIM.

ANDROID_SMS_GATEWAY_URL is the server's 3rdparty REST API base, e.g.
https://<domain>/sms-api/3rdparty/v1 — see DEPLOY.md's device registration
steps for where ANDROID_SMS_GATEWAY_USERNAME/PASSWORD (the registered
account's login, used as HTTP Basic Auth) come from. The customer will see
that phone's own SIM number as the sender, not a custom sender id.
"""

import re

import requests
from requests.auth import HTTPBasicAuth

import config


class AndroidGatewayError(Exception):
    pass


def _to_e164(to_number):
    """The gateway's 3rdparty API rejects local-format numbers outright
    (400 "invalid phone number") - it requires E.164. Callers throughout
    this app pass Ethiopian local format (0916182957), so normalize that
    one specific, known shape here rather than pushing this concern onto
    every caller. Anything already starting with "+" is left untouched.
    """
    digits = re.sub(r"\D", "", to_number)
    if to_number.strip().startswith("+"):
        return f"+{digits}"
    if digits.startswith("0") and len(digits) == 10:
        return f"+251{digits[1:]}"
    if digits.startswith("251"):
        return f"+{digits}"
    return to_number


def send_sms(to_number, message):
    """Send an SMS via the private SMS Gateway server. Returns (success, detail)."""
    if not to_number or not message:
        raise AndroidGatewayError("A destination number and message are required")

    url = f"{config.ANDROID_SMS_GATEWAY_URL.rstrip('/')}/messages"
    payload = {
        "textMessage": {"text": message},
        "phoneNumbers": [_to_e164(to_number)],
    }

    try:
        resp = requests.post(
            url,
            json=payload,
            auth=HTTPBasicAuth(config.ANDROID_SMS_GATEWAY_USERNAME, config.ANDROID_SMS_GATEWAY_PASSWORD),
            timeout=10,
        )
    except requests.RequestException as e:
        raise AndroidGatewayError(f"Could not reach Android Gateway at {url}: {e}")

    if resp.status_code not in (200, 201, 202):
        raise AndroidGatewayError(f"Gateway returned HTTP {resp.status_code}: {resp.text[:300]}")

    return True, resp.text[:500]
