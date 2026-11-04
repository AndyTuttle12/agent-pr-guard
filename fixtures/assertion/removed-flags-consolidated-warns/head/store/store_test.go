package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGet(t *testing.T) {
	item := Get("a")
	assert.Equal(t, Item{Key: "a", Count: 3}, item)
}
