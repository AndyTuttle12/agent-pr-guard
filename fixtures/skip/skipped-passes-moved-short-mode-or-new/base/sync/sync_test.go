package sync

import "testing"

func TestFullSync(t *testing.T) {
	if err := FullSync(); err != nil {
		t.Fatal(err)
	}
}
