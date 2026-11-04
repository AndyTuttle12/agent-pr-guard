package main

import "os"

func main() {
	f, err := os.Open("data.txt")
	if err != nil {
		panic(err)
	}
	defer f.Close() //nolint:errcheck // a read-only file, a failed close loses nothing
}
