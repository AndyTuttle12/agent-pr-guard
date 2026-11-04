import pytest

from rates import rate


def test_rate():
    assert rate("EUR") == pytest.approx(1.0912, abs=0.0001)
