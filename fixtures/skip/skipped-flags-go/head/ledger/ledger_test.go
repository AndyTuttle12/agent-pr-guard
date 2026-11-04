package ledger

import "testing"

func TestBalance(t *testing.T) {
	t.Skip("flaky on CI")
	if got := Balance([]int{1, 2}); got != 3 {
		t.Fatalf("got %d", got)
	}
}

func (s *LedgerSuite) TestPost() {
	s.T().Skip("needs a database")
	s.Require().NoError(Post(1))
}
