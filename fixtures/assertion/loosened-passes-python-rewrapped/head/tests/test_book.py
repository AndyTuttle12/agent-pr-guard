from book import best_bid, pick_token


def test_best_bid_first():
    bids = best_bid()
    assert (
        float(bids[0]["price"]) == 0.58
    ), f"expected best bid 0.58 at index 0, got {bids[0]['price']}"


def test_picks_yes_token():
    selected = pick_token(["no", "yes"])
    assert (
        selected == "yes"
    ), "should pick YES even when NO is listed first"
