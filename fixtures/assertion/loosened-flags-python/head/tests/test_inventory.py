import unittest

import pytest

from inventory import Inventory, OutOfStock


def test_reserve():
    inv = Inventory({"apple": 3})
    inv.reserve("apple", 2)
    assert inv.available("apple")


def test_reserve_too_many():
    inv = Inventory({"apple": 1})
    with pytest.raises(Exception):
        inv.reserve("apple", 2)


class RestockTest(unittest.TestCase):
    def test_restock(self):
        inv = Inventory({})
        inv.restock("pear", 4)
        self.assertTrue(inv.available("pear"))
