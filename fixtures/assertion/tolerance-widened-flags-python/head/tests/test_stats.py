import math
import unittest

import numpy as np
import pytest

from stats import mean, stdev


def test_mean():
    assert mean([0.1, 0.2]) == pytest.approx(0.15, rel=1e-2)


def test_stdev():
    np.testing.assert_allclose(stdev([1, 2, 3]), 0.816496580927726, rtol=0.05)


def test_isclose():
    assert math.isclose(mean([1, 2]), 1.5, abs_tol=0.1)


class MeanTest(unittest.TestCase):
    def test_thirds(self):
        self.assertAlmostEqual(mean([1, 2, 4]), 2.3333333, places=1)
