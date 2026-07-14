package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Server struct {
	*http.ServeMux
	sync.Mutex
	token  string
	root   string
	stages map[string]struct{}
}

func newServer(token, root string) *Server {
	s := &Server{
		ServeMux: http.NewServeMux(),
		token:    token,
		root:     root,
		stages:   make(map[string]struct{}),
	}

	s.HandleFunc("/publish", s.handlePublish)
	s.HandleFunc("/confirm", s.handleConfirm)

	return s
}

func (s *Server) currentDir() string {
	return filepath.Join(s.root, "current")
}

func (s *Server) stageDir(id string) string {
	return filepath.Join(s.root, id)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer "+s.token {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	s.ServeMux.ServeHTTP(w, r)
}

func (s *Server) deleteStage(id string) error {
	s.Lock()
	defer s.Unlock()

	delete(s.stages, id)
	return os.RemoveAll(s.stageDir(id))
}

func (s *Server) handlePublish(w http.ResponseWriter, r *http.Request) {
	mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil {
		if errors.Is(err, mime.ErrInvalidMediaParameter) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if !strings.HasPrefix(mediaType, "multipart/") {
		http.Error(w, "invalid Content-Type", http.StatusBadRequest)
		return
	}

	id := fmt.Sprintf("%d", time.Now().UnixNano())
	s.Lock()
	s.stages[id] = struct{}{}
	s.Unlock()
	_ = time.AfterFunc(time.Hour, func() { s.deleteStage(id) })

	mr := multipart.NewReader(r.Body, params["boundary"])
	if err := writeForToStagingArea(s.stageDir(id), mr); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := os.MkdirAll(s.currentDir(), 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	diff, err := computeDiff(s.currentDir(), s.stageDir(id))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := struct {
		ID   string `json:"id"`
		Diff string `json:"diff"`
	}{
		ID:   id,
		Diff: diff,
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(&response); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func writeForToStagingArea(dir string, mr *multipart.Reader) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return err
	}
	defer root.Close()

	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		if err := writeToFile(root, p); err != nil {
			return err
		}
	}
	return nil
}

func writeToFile(root *os.Root, p *multipart.Part) error {
	fname := p.FormName()

	if err := root.MkdirAll(filepath.Dir(fname), 0o755); err != nil {
		return err
	}

	f, err := root.OpenFile(p.FormName(), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()

	_, cerr := io.Copy(f, p)
	return cerr
}

func (s *Server) handleConfirm(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.Lock()
	defer s.Unlock()

	if _, ok := s.stages[payload.ID]; !ok {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	if err := s.swapDirs(payload.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (s *Server) swapDirs(id string) error {
	currentDir := s.currentDir()
	oldDir := currentDir + ".old"

	if err := os.Rename(currentDir, oldDir); err != nil {
		return err
	}
	if err := os.Rename(s.stageDir(id), currentDir); err != nil {
		return err
	}
	if err := os.RemoveAll(oldDir); err != nil {
		return err
	}

	delete(s.stages, id)

	return nil
}
