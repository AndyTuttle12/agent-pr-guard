package store

import "testing"

func TestMemory(t *testing.T) {
	if got := New().Rows(); len(got) != 0 {
		t.Fatalf("rows = %v", got)
	}
}
