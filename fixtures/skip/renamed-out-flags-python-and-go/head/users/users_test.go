package users

import "testing"

func testCreate(t *testing.T) {
	if New("ada").Name != "ada" {
		t.Fatal("name")
	}
}
