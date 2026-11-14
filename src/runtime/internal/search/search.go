package search

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
	"wisewave-runtime/internal/models"
)

type Retrieve func(context.Context, string) ([]models.Track, error)

type Engine struct {
	retrieve Retrieve
	mu       sync.Mutex
	cache    map[string]entry
	pending  map[string]*flight
}

func New(retrieve Retrieve) *Engine {
	return &Engine{retrieve: retrieve, cache: make(map[string]entry), pending: make(map[string]*flight)}
}

func (e *Engine) Search(ctx context.Context, query string) ([]models.Track, error) {
	return e.SearchWithRanker(ctx, query, Ranker{})
}

func (e *Engine) SearchWithRanker(ctx context.Context, query string, ranker Ranker) ([]models.Track, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if len(query) > 512 {
		return nil, errors.New("search: query exceeds 512 bytes")
	}
	key := Normalize(query)
	if key == "" {
		return []models.Track{}, nil
	}
	e.mu.Lock()
	if cached, ok := e.cache[key]; ok && time.Now().Before(cached.expires) {
		tracks := append([]models.Track{}, cached.tracks...)
		e.mu.Unlock()
		return ranker.Tracks(query, tracks), nil
	}
	if f, ok := e.pending[key]; ok {
		e.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-f.done:
			return ranker.Tracks(query, f.tracks), f.err
		}
	}
	f := &flight{done: make(chan struct{})}
	e.pending[key] = f
	e.mu.Unlock()
	tracks, err := e.retrieve(ctx, query)
	e.mu.Lock()
	f.tracks, f.err = append([]models.Track{}, tracks...), err
	if err == nil {
		if len(e.cache) >= 128 {
			var oldest string
			var expiry time.Time
			for k, v := range e.cache {
				if expiry.IsZero() || v.expires.Before(expiry) || (v.expires.Equal(expiry) && k < oldest) {
					oldest, expiry = k, v.expires
				}
			}
			delete(e.cache, oldest)
		}
		e.cache[key] = entry{f.tracks, time.Now().Add(5 * time.Minute)}
	}
	delete(e.pending, key)
	close(f.done)
	e.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return ranker.Tracks(query, tracks), nil
}

func (e *Engine) Suggestions(query string, limit int) []string {
	if limit <= 0 || Normalize(query) == "" {
		return []string{}
	}
	e.mu.Lock()
	var tracks []models.Track
	keys := make([]string, 0, len(e.cache))
	for k := range e.cache {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := e.cache[k]
		if time.Now().Before(v.expires) {
			tracks = append(tracks, v.tracks...)
		}
	}
	e.mu.Unlock()
	out := make([]string, 0, limit)
	seen := map[string]bool{}
	for _, v := range (Ranker{}).Rank(query, tracks) {
		if v.Score < .2 {
			continue
		}
		for _, s := range []string{v.Track.Title, v.Track.Artist} {
			key := Normalize(s)
			if key != "" && !seen[key] && coverage(tokens(Normalize(query)), tokens(key)) > .6 {
				seen[key] = true
				out = append(out, s)
				if len(out) == limit {
					return out
				}
			}
		}
	}
	return out
}
