from slugs import slugify, unslug


def test_round_trip():
    assert slugify("a b") == "a-b"


def test_unslug():
    assert unslug("hello-world") == "hello world"
    assert unslug("") == ""
