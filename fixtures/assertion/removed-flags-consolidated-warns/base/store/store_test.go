package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGet(t *testing.T) {
	item := Get("a")
	assert.Equal(t, "a", item.Key)
	assert.Equal(t, 3, item.Count)
}
