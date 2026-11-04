import unittest

from billing import charge


def _build_card():
    return "4242"


def test_charge_succeeds():
    assert charge(_build_card(), 5) == "ok"


class RefundCases(unittest.TestCase):
    def test_refund(self):
        self.assertEqual(charge(_build_card(), -5), "refund")
