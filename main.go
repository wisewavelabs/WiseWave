package main

import (
	_ "embed"
	"log"
	"os"

	"wisewave-runtime/app"
	"wisewave/src/app/native"
)

//go:embed resources/images/icon.png
var icon []byte

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--server" {
		if err := app.Run(); err != nil {
			log.Fatal(err)
		}
		return
	}
	native.Run(icon)
}
