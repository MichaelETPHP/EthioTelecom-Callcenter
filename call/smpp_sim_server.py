"""Minimal local SMPP test server (SMSC simulator) — DEVELOPMENT USE ONLY.

This lets you exercise the real SMPP client code path (smpp_gateway.py)
without a real carrier/aggregator account. It accepts any bind
credentials, acknowledges submit_sm requests, and prints every message it
"received" to the console. No message ever reaches a real phone — this is
purely for proving the client integration works before pointing it at a
real SMPP provider (swap SMPP_HOST/PORT/credentials in config.py).

Run standalone: python smpp_sim_server.py
"""

import socket
import threading

import smpplib.client
import smpplib.command
import smpplib.consts
import smpplib.smpp

HOST = "0.0.0.0"
PORT = 2775

# A throwaway object satisfying what smpplib's PDU parser/factory expects.
_pdu_ctx = smpplib.client.Client.__new__(smpplib.client.Client)
_pdu_ctx.allow_unknown_opt_params = True
_pdu_ctx.sequence_generator = smpplib.client.SimpleSequenceGenerator()


def _recv_exact(sock, size):
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise ConnectionError("client disconnected")
        data += chunk
    return data


def _read_pdu(sock):
    import struct

    raw_len = _recv_exact(sock, 4)
    length = struct.unpack(">L", raw_len)[0]
    raw_pdu = raw_len + _recv_exact(sock, length - 4)
    return smpplib.smpp.parse_pdu(raw_pdu, client=_pdu_ctx)


def _send_pdu(sock, pdu):
    sock.sendall(pdu.generate())


def _handle_client(sock, addr):
    print(f"[smpp-sim] connection from {addr}")
    msg_counter = 0
    try:
        while True:
            pdu = _read_pdu(sock)
            if pdu is None:
                break

            if pdu.command in ("bind_transceiver", "bind_transmitter", "bind_receiver"):
                resp = smpplib.smpp.make_pdu(f"{pdu.command}_resp", client=_pdu_ctx)
                resp.sequence = pdu.sequence
                resp.system_id = "smpp-sim"
                _send_pdu(sock, resp)
                print(f"[smpp-sim] {addr} bound as system_id={pdu.system_id!r}")

            elif pdu.command == "enquire_link":
                resp = smpplib.smpp.make_pdu("enquire_link_resp", client=_pdu_ctx)
                resp.sequence = pdu.sequence
                _send_pdu(sock, resp)

            elif pdu.command == "submit_sm":
                msg_counter += 1
                message_id = f"SIM{msg_counter:06d}"
                text = pdu.short_message.decode(errors="replace") if pdu.short_message else ""
                print(
                    f"[smpp-sim] SMS from {pdu.source_addr.decode()} to "
                    f"{pdu.destination_addr.decode()}: {text!r} -> message_id={message_id}"
                )
                resp = smpplib.smpp.make_pdu("submit_sm_resp", client=_pdu_ctx)
                resp.sequence = pdu.sequence
                resp.message_id = message_id
                _send_pdu(sock, resp)

            elif pdu.command == "unbind":
                resp = smpplib.smpp.make_pdu("unbind_resp", client=_pdu_ctx)
                resp.sequence = pdu.sequence
                _send_pdu(sock, resp)
                break

    except (ConnectionError, OSError):
        pass
    finally:
        sock.close()
        print(f"[smpp-sim] {addr} disconnected")


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((HOST, PORT))
    srv.listen(5)
    print(f"[smpp-sim] listening on {HOST}:{PORT} (Ctrl+C to stop)")
    try:
        while True:
            sock, addr = srv.accept()
            threading.Thread(target=_handle_client, args=(sock, addr), daemon=True).start()
    except KeyboardInterrupt:
        pass
    finally:
        srv.close()


if __name__ == "__main__":
    main()
