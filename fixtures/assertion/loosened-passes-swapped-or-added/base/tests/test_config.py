import unittest

from config import load


class LoadTest(unittest.TestCase):
    def test_load(self):
        cfg = load("app.toml")
        self.assertTrue(cfg["port"] == 8080)
        self.assertEqual(cfg["name"], "app")
