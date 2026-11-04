package parse_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Parse", func() {
	PIt("parses ints", func() {
		Expect(Parse("1")).To(Equal(1))
	})
})
