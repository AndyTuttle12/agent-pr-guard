from slugs import slugify, unslug


def test_slugify():
    assert slugify("Hello World") == "hello-world"


def test_unslug():
    assert unslug("hello-world") == "hello world"
    assert unslug("") == ""
