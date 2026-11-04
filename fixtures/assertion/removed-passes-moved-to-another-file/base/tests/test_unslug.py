from slugs import slugify


def test_round_trip():
    assert slugify("a b") == "a-b"
