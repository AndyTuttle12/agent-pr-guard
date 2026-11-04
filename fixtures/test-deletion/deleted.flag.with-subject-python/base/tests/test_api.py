from app.api import status


def test_status():
    assert status() == "ok"
