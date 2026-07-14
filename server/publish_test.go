package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTree(files map[string][]byte) (*bytes.Buffer, string, error) {
	body := &bytes.Buffer{}
	mw := multipart.NewWriter(body)
	for name, content := range files {
		part, err := mw.CreateFormFile(name, name)
		if err != nil {
			return nil, "", err
		}
		if _, err := part.Write(content); err != nil {
			return nil, "", err
		}
	}
	if err := mw.Close(); err != nil {
		return nil, "", err
	}
	return body, mw.FormDataContentType(), nil
}

func readTree(dir string) (map[string][]byte, error) {
	files := make(map[string][]byte)
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		files[rel] = content
		return nil
	})
	return files, err
}

func publishAndConfirm(t *testing.T, s *Server, files map[string][]byte) {
	t.Helper()

	body, contentType, err := writeTree(files)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("POST", "/publish", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer t")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("publish: got %d, body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		ID   string `json:"id"`
		Diff string `json:"diff"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.ID == "" {
		t.Fatal("publish: empty id")
	}
	if resp.Diff == "" {
		t.Error("publish: diff is empty, want a non-empty diff for a changed tree")
	}

	confirmBody := fmt.Sprintf(`{"id":%q}`, resp.ID)
	req = httptest.NewRequest("POST", "/confirm", strings.NewReader(confirmBody))
	req.Header.Set("Authorization", "Bearer t")
	rec = httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("confirm: got %d, body %s", rec.Code, rec.Body.String())
	}

	got, err := readTree(s.currentDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(files) {
		t.Fatalf("current tree has %d files, want %d: %v", len(got), len(files), got)
	}
	for name, want := range files {
		content, ok := got[name]
		if !ok {
			t.Errorf("missing %s in published tree", name)
			continue
		}
		if !bytes.Equal(content, want) {
			t.Errorf("%s: got %q, want %q", name, content, want)
		}
	}

	entries, err := os.ReadDir(s.root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "current" {
		names := make([]string, len(entries))
		for i, e := range entries {
			names[i] = e.Name()
		}
		t.Errorf("root should contain only current after confirm, got %v", names)
	}
}

func TestPublishConfirm(t *testing.T) {
	root := t.TempDir()
	s := newServer("t", root)

	publishAndConfirm(t, s, map[string][]byte{
		"kept.md":     []byte("unchanged\n"),
		"modified.md": []byte("original content\n"),
		"deleted.md":  []byte("will be removed\n"),
		"image.png":   {0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff, 0xfe},
	})

	publishAndConfirm(t, s, map[string][]byte{
		"kept.md":     []byte("unchanged\n"),
		"modified.md": []byte("updated content\n"),
		"added.md":    []byte("new note\n"),
	})
}
