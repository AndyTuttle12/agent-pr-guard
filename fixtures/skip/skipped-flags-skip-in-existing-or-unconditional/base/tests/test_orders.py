import pytest

from orders import Order, connect


def test_total():
    assert Order([1, 2]).total == 3


def test_saved():
    db = connect()
    assert db.save(Order([1])).id is not None
