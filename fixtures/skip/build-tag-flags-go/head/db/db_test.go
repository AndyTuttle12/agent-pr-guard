//go:build integration

package db

import "testing"

func TestOpen(t *testing.T) {
	if _, err := Open(":memory:"); err != nil {
		t.Fatal(err)
	}
}
