package billing

import "testing"

func TestCharge(t *testing.T) {
	if Charge(5) != "ok" {
		t.Fatal("charge")
	}
}
