"""Send SMS through 'SMS Gateway for Android' (capcom6/android-sms-gateway),
running in Local Server mode on a spare Android phone with a SIM card.

https://github.com/capcom6/android-sms-gateway

No special hardware needed beyond the phone itself — install the app,
enable "Local Server", and point ANDROID_SMS_GATEWAY_URL/USERNAME/PASSWORD
in config.py at what it shows. The customer will see that phone's own SIM
number as the sender, same as the USB-dongle approach, but over local
Wi-Fi/HTTP instead of a serial AT-command connection.
"""

import requests
from requests.auth import HTTPBasicAuth

import config


class AndroidGatewayError(Exception):
    pass


def send_sms(to_number, message):
    """Send an SMS via the Android SMS Gateway app. Returns (success, detail)."""
    if not to_number or not message:
        raise AndroidGatewayError("A destination number and message are required")

    url = f"{config.ANDROID_SMS_GATEWAY_URL.rstrip('/')}/message"
    payload = {
        "textMessage": {"text": message},
        "phoneNumbers": [to_number],
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
