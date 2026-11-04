from users import User


def test_create():
    assert User("ada").name == "ada"


class TestDelete:
    def test_delete(self):
        assert User("ada").delete() is True
