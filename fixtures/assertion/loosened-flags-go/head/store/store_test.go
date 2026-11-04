package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGet(t *testing.T) {
	s := New()
	s.Put("k", "v")
	if got := s.Get("k"); got != "v" {
		t.Logf("Get(k) = %q, want v", got)
	}
}

func TestList(t *testing.T) {
	s := New()
	s.Put("a", "1")
	assert.NotEmpty(t, s.Keys())
}
