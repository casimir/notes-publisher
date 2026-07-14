package main

import (
	"log"
	"net/http"
	"os"
)

func main() {
	token := os.Getenv("PUBLISHER_TOKEN")
	if token == "" {
		log.Fatal("PUBLISHER_TOKEN must be set")
	}
	root := os.Getenv("PUBLISHER_ROOT")
	if root == "" {
		log.Fatal("PUBLISHER_ROOT must be set")
	}

	if err := http.ListenAndServe(":8080", newServer(token, root)); err != nil {
		log.Fatal(err)
	}
}
