package ledger

import "testing"

func TestBalance(t *testing.T) {
	if got := Balance([]int{1, 2}); got != 3 {
		t.Fatalf("got %d", got)
	}
}

func (s *LedgerSuite) TestPost() {
	s.Require().NoError(Post(1))
}
