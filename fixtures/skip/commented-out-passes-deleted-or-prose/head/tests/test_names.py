from names import title


# See also def test_title_unicode(): in test_unicode.py
def test_title():
    assert title("ada") == "Ada"
