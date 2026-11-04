package store

import (
	"os"
	"testing"
)

func TestMemory(t *testing.T) {
	if got := New().Rows(); len(got) != 0 {
		t.Fatalf("rows = %v", got)
	}
}

func TestDatabase(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL is not set")
	}
	if got := Connect(url).Rows(); len(got) != 0 {
		t.Fatalf("rows = %v", got)
	}
}
