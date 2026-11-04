import unittest

from billing import charge


def _make_card():
    return "4242"


def test_charge():
    assert charge(_make_card(), 5) == "ok"


class TestRefunds(unittest.TestCase):
    def test_refund(self):
        self.assertEqual(charge(_make_card(), -5), "refund")
