//go:build linux || darwin

package fs

import "testing"

func TestStat(t *testing.T) {
	if _, err := Stat("."); err != nil {
		t.Fatal(err)
	}
}
