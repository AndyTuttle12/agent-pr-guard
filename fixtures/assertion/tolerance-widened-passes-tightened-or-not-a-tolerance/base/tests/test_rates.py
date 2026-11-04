import pytest

from rates import rate


def test_rate():
    assert rate("EUR") == pytest.approx(1.09, abs=0.01)
