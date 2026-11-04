import sys

import pytest

from paths import Denied, check


def test_inside_root_allowed(library):
    assert check(library / "a.txt") == library / "a.txt"


def test_parent_escape_denied(library):
    with pytest.raises(Denied):
        check(library / ".." / "secret.txt")


def test_symlink_escape_denied(library, outside):
    link = library / "escape.txt"
    try:
        link.symlink_to(outside)
    except OSError as exc:
        pytest.skip(f"could not create symlink: {exc}")
    with pytest.raises(Denied):
        check(link)


def test_yaml_policy_loads(library):
    yaml = pytest.importorskip("yaml")
    assert check(library / yaml.safe_load("a.txt"))


@pytest.mark.skipif(sys.platform != "win32", reason="drive letters are Windows-only")
def test_drive_letter_denied():
    with pytest.raises(Denied):
        check("D:\\secret.txt")
