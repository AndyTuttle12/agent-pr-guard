package api

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestStatus(t *testing.T) {
	got := Status()
	assert.Equal(t, &Result{OK: true}, got)
	t.Errorf("unexpected extra call: %v", got)
}
