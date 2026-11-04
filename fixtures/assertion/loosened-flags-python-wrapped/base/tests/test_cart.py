from cart import Cart


def test_total_counts_items():
    total = Cart(["a", "b", "c"]).total()
    assert (
        total == 3
    ), "three items in the cart"
