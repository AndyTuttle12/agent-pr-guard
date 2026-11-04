package api_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("API", func() {
	It("serves health", func() {
		Expect(Health()).To(Equal("ok"))
	})
})
