from series import correct


def test_correct_keeps_values():
    assert correct([1, 2]) == [1, 2]
