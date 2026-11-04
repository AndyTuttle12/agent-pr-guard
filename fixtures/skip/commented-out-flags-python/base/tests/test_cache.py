from cache import Cache


def test_get():
    assert Cache({"a": 1}).get("a") == 1


def test_miss():
    assert Cache({}).get("a") is None


def test_evict():
    c = Cache({"a": 1}, size=0)
    assert c.get("a") is None
