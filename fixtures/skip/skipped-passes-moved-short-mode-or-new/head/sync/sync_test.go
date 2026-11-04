package sync

import "testing"

func TestFullSync(t *testing.T) {
	if testing.Short() {
		t.Skip("full sync is slow")
	}
	if err := FullSync(); err != nil {
		t.Fatal(err)
	}
}
