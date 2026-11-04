from users import User


def _test_create():
    assert User("ada").name == "ada"


class _TestDelete:
    def test_delete(self):
        assert User("ada").delete() is True
