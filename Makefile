.PHONY: test test-obsidian test-server

test: test-obsidian test-server

test-obsidian:
	cd obsidian && npm test

test-server:
	cd server && go test ./...
