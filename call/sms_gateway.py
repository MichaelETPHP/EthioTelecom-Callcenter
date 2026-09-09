"""Send SMS through a USB GSM/3G dongle using plain AT commands.

This talks directly to the modem's AT-command serial port (not SMPP, not
any carrier API) — it works like a phone sending a text. That means the
recipient sees the SIM card's own phone number as the sender, never a
custom label like "8840". Getting a custom sender id requires an SMPP or
HTTP gateway from the telecom/an SMS aggregator instead (see README.md).
"""

import threading
import time

import serial
import serial.tools.list_ports

import config

_lock = threading.Lock()

CTRL_Z = b"\x1a"
ESC = b"\x1b"


class ModemError(Exception):
    pass


def list_serial_ports():
    """Return [{device, description, hwid}] for every serial port Windows sees."""
    ports = []
    for p in serial.tools.list_ports.comports():
        ports.append({"device": p.device, "description": p.description, "hwid": p.hwid})
    return ports


def _open_serial(port=None, baudrate=None, timeout=5):
    return serial.Serial(
        port or config.SMS_COM_PORT,
        baudrate or config.SMS_BAUDRATE,
        timeout=timeout,
    )


def _read_until(ser, terminators, timeout):
    deadline = time.time() + timeout
    buf = ""
    while time.time() < deadline:
        waiting = ser.in_waiting
        if waiting:
            buf += ser.read(waiting).decode(errors="ignore")
            if any(t in buf for t in terminators):
                break
        else:
            time.sleep(0.05)
    return buf


def _send_at(ser, command, timeout=5, terminators=("OK", "ERROR")):
    ser.reset_input_buffer()
    ser.write((command + "\r\n").encode())
    return _read_until(ser, terminators, timeout)


def test_port(port, baudrate=None, timeout=3):
    """Send a plain AT ping to a port and report whether the modem answered OK."""
    try:
        ser = _open_serial(port=port, baudrate=baudrate, timeout=timeout)
    except Exception as e:
        return {"port": port, "ok": False, "error": str(e)}
    try:
        resp = _send_at(ser, "AT", timeout=timeout)
        return {"port": port, "ok": "OK" in resp, "response": resp.strip()}
    finally:
        ser.close()


def _is_gsm7_compatible(text):
    try:
        text.encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def _ucs2_hex(text):
    return text.encode("utf-16-be").hex().upper()


def send_sms(to_number, message):
    """Send an SMS via the configured modem. Returns (success, detail)."""
    if not to_number or not message:
        raise ModemError("A destination number and message are required")

    with _lock:
        try:
            ser = _open_serial(timeout=5)
        except serial.SerialException as e:
            raise ModemError(f"Could not open {config.SMS_COM_PORT}: {e}")
        try:
            boot = _send_at(ser, "AT", timeout=5)
            if "OK" not in boot:
                raise ModemError(f"Modem on {config.SMS_COM_PORT} did not respond to AT: {boot!r}")

            if config.SMS_PIN:
                pin_resp = _send_at(ser, f'AT+CPIN="{config.SMS_PIN}"', timeout=5)
                if "OK" not in pin_resp and "ERROR" in pin_resp:
                    raise ModemError(f"SIM PIN rejected: {pin_resp!r}")

            unicode_mode = not _is_gsm7_compatible(message)
            _send_at(ser, f'AT+CSCS="{"UCS2" if unicode_mode else "GSM"}"', timeout=5)
            cmgf = _send_at(ser, "AT+CMGF=1", timeout=5)  # text mode
            if "OK" not in cmgf:
                raise ModemError(f"Modem rejected text mode (AT+CMGF=1): {cmgf!r}")

            ser.reset_input_buffer()
            ser.write(f'AT+CMGS="{to_number}"\r'.encode())
            # Modem replies with "> " prompting for the message body.
            prompt = _read_until(ser, (">",), timeout=5)
            if ">" not in prompt:
                raise ModemError(f"Modem did not prompt for message body: {prompt!r}")

            body = _ucs2_hex(message) if unicode_mode else message
            ser.write(body.encode() + CTRL_Z)
            result = _read_until(ser, ("+CMGS", "OK", "ERROR"), timeout=20)

            success = "+CMGS" in result or ("OK" in result and "ERROR" not in result)
            return success, result.strip()
        except serial.SerialException as e:
            raise ModemError(f"Lost connection to {config.SMS_COM_PORT}: {e}")
        finally:
            ser.close()
