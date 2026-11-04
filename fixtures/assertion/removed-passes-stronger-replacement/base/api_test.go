package api

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestStatus(t *testing.T) {
	got := Status()
	assert.NotNil(t, got)
	t.Logf("status: %v", got)
}
