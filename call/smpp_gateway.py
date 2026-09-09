"""Send SMS through a real SMPP connection (carrier or aggregator).

Unlike sms_gateway.py (which drives a physical SIM/modem), this talks
SMPP — the protocol real telecom-grade SMS providers use. It's useless on
its own: SMPP_HOST/PORT/SYSTEM_ID/PASSWORD in config.py must point at an
account you actually have (a carrier or aggregator's SMPP endpoint), or
the local test simulator (smpp_sim_server.py) for development.
"""

import threading

import smpplib.client
import smpplib.consts
import smpplib.exceptions
import smpplib.gsm

import config

_lock = threading.Lock()


class SmppError(Exception):
    pass


def send_sms(to_number, message, source_addr=None):
    """Send an SMS via the configured SMPP account. Returns (success, detail)."""
    if not to_number or not message:
        raise SmppError("A destination number and message are required")

    with _lock:
        client = smpplib.client.Client(config.SMPP_HOST, config.SMPP_PORT, timeout=10)
        try:
            client.connect()
        except Exception as e:
            raise SmppError(f"Could not connect to SMPP host {config.SMPP_HOST}:{config.SMPP_PORT}: {e}")

        try:
            client.bind_transceiver(
                system_id=config.SMPP_SYSTEM_ID,
                password=config.SMPP_PASSWORD,
            )
        except smpplib.exceptions.PDUError as e:
            raise SmppError(f"SMPP bind rejected: {e}")

        try:
            message_ids = []
            parts, encoding_flag, msg_type_flag = smpplib.gsm.make_parts(message)
            for part in parts:
                client.send_message(
                    source_addr_ton=smpplib.consts.SMPP_TON_INTL,
                    source_addr=source_addr or config.SMPP_SOURCE_ADDR,
                    dest_addr_ton=smpplib.consts.SMPP_TON_INTL,
                    destination_addr=to_number,
                    short_message=part,
                    data_coding=encoding_flag,
                    esm_class=msg_type_flag,
                    registered_delivery=False,
                )
                resp = client.read_pdu()
                if resp.command == "submit_sm_resp":
                    message_ids.append(resp.message_id.decode() if isinstance(resp.message_id, bytes) else resp.message_id)

            return True, f"message_id(s): {', '.join(message_ids) or 'unknown'}"
        except Exception as e:
            raise SmppError(f"Send failed: {e}")
        finally:
            try:
                client.unbind()
            except Exception:
                pass
            client.disconnect()
