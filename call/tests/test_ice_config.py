import os
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch


class IceConfigTests(unittest.TestCase):
    def load(self, env):
        with patch.dict(os.environ, env, clear=True):
            return runpy.run_path(str(Path(__file__).resolve().parents[1] / 'config.py'))['ICE_SERVERS']

    def test_without_password_only_stun_is_advertised(self):
        self.assertEqual(self.load({}), [{'urls': 'stun:stun.l.google.com:19302'}])

    def test_relay_uses_compose_credentials_and_public_address(self):
        relay = self.load({'TURN_EXTERNAL_IP': '203.0.113.10', 'TURN_PORT': '3479',
                           'TURN_USER': 'agent', 'TURN_PASSWORD': 'test'})[1]
        self.assertEqual(relay['username'], 'agent')
        self.assertEqual(relay['credential'], 'test')
        self.assertEqual(relay['urls'], ['turn:203.0.113.10:3479?transport=udp',
                                         'turn:203.0.113.10:3479?transport=tcp'])

    def test_blank_external_ip_falls_back_to_public_realm(self):
        relay = self.load({'TURN_EXTERNAL_IP': '', 'TURN_REALM': 'relay.example',
                           'TURN_PASSWORD': 'test'})[1]
        self.assertEqual(relay['urls'][0], 'turn:relay.example:3478?transport=udp')


if __name__ == '__main__':
    unittest.main()
