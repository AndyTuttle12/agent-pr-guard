import unittest

import pytest
from orders import Order


def test_total():
    assert Order([1, 2]).total == 3


def test_refund():
    assert Order([5]).refund().total == 0


def test_tax():
    assert Order([10]).tax == 1


class TestShipping(unittest.TestCase):
    def test_free_over_fifty(self):
        self.assertEqual(Order([60]).shipping, 0)

    def test_flat_rate(self):
        self.assertEqual(Order([10]).shipping, 5)
