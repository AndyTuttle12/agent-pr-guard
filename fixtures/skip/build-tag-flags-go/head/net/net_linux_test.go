package net

import "testing"

func TestDial(t *testing.T) {
	if err := Dial("localhost"); err != nil {
		t.Fatal(err)
	}
}
