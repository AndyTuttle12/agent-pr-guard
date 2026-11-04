import unittest

import pytest

from inventory import Inventory, OutOfStock


def test_reserve():
    inv = Inventory({"apple": 3})
    inv.reserve("apple", 2)
    assert inv.available("apple") == 1


def test_reserve_too_many():
    inv = Inventory({"apple": 1})
    with pytest.raises(OutOfStock):
        inv.reserve("apple", 2)


class RestockTest(unittest.TestCase):
    def test_restock(self):
        inv = Inventory({})
        inv.restock("pear", 4)
        self.assertEqual(inv.available("pear"), 4)
