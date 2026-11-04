package geo

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
)

const tolerance = 1e-9

func TestDistance(t *testing.T) {
	got := Distance(Point{0, 0}, Point{3, 4})
	if math.Abs(got-5) > tolerance {
		t.Fatalf("Distance = %v, want 5", got)
	}
}

func TestBearing(t *testing.T) {
	assert.InDelta(t, 90.0, Bearing(Point{0, 0}, Point{1, 0}), 0.0001)
}

func TestScale(t *testing.T) {
	if math.Abs(Scale(2)-0.5) > 1e-12 {
		t.Error("Scale(2) != 0.5")
	}
}
