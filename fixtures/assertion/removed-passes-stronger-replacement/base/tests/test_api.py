from api import get_status


def test_status():
    status = get_status()
    assert status
