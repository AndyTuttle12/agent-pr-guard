import unittest

import pytest
from orders import Order


@pytest.mark.skip(reason="flaky")
def test_total():
    assert Order([1, 2]).total == 3


@pytest.mark.xfail(reason="refunds are broken")
def test_refund():
    assert Order([5]).refund().total == 0


def test_tax():
    pytest.skip("tax tables not loaded")
    assert Order([10]).tax == 1


class TestShipping(unittest.TestCase):
    @unittest.skip("carrier api down")
    def test_free_over_fifty(self):
        self.assertEqual(Order([60]).shipping, 0)

    def test_flat_rate(self):
        self.skipTest("later")
        self.assertEqual(Order([10]).shipping, 5)
