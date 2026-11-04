package users

import "testing"

func TestCreate(t *testing.T) {
	if New("ada").Name != "ada" {
		t.Fatal("name")
	}
}
