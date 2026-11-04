package billing

import "testing"

func TestCharge_Succeeds(t *testing.T) {
	if Charge(5) != "ok" {
		t.Fatal("charge")
	}
}
