import pytest

from paths import Denied, check


def test_inside_root_allowed(library):
    assert check(library / "a.txt") == library / "a.txt"


def test_parent_escape_denied(library):
    with pytest.raises(Denied):
        check(library / ".." / "secret.txt")
