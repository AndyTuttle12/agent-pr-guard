import unittest

from config import load


class LoadTest(unittest.TestCase):
    def test_load(self):
        cfg = load("app.toml")
        self.assertEqual(cfg["port"], 8080)
        self.assertDictEqual(cfg, {"name": "app", "port": 8080})
