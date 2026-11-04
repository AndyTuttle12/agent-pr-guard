package mathx

import "testing"

func TestAbs(t *testing.T) {
	if Abs(-1) != 1 {
		t.Fatal("abs")
	}
}

func TestMax(t *testing.T) {
	if Max(1, 2) != 2 {
		t.Fatal("max")
	}
}
