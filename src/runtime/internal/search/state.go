package search

import (
	"sync"
	"time"
	"wisewave-runtime/internal/models"
)

type PageState struct {
	Query   string
	expires time.Time
	Seen    map[string]bool
}

type State struct {
	mu          sync.Mutex
	pages       map[string]PageState
	preferences func() func(models.Track) float64
}

func (c *State) SetPreferences(snapshot func() func(models.Track) float64) {
	c.mu.Lock()
	c.preferences = snapshot
	c.mu.Unlock()
}

func (c *State) Ranker() Ranker {
	c.mu.Lock()
	snapshot := c.preferences
	c.mu.Unlock()
	r := Ranker{}
	if snapshot != nil {
		r.Preference = snapshot()
	}
	return r
}

func (c *State) Page(token string) PageState {
	c.mu.Lock()
	defer c.mu.Unlock()
	state := c.pages[token]
	if time.Now().After(state.expires) {
		delete(c.pages, token)
		return PageState{}
	}

	seen := make(map[string]bool, len(state.Seen))
	for id, value := range state.Seen {
		seen[id] = value
	}
	state.Seen = seen
	return state
}

func (c *State) RememberPage(query, token string, ids []string, previous PageState) {
	if token == "" || query == "" {
		return
	}
	seen := make(map[string]bool, len(previous.Seen)+len(ids))
	for id := range previous.Seen {
		seen[id] = true
	}
	for _, id := range ids {
		if id != "" {
			seen[id] = true
		}
	}

	if len(seen) > 4096 {
		seen = make(map[string]bool)
		for _, id := range ids {
			if id != "" {
				seen[id] = true
			}
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pages == nil {
		c.pages = make(map[string]PageState)
	}
	if len(c.pages) >= 128 {
		oldest := ""
		var expiry time.Time
		for token, state := range c.pages {
			if expiry.IsZero() || state.expires.Before(expiry) || (state.expires.Equal(expiry) && token < oldest) {
				oldest, expiry = token, state.expires
			}
		}
		delete(c.pages, oldest)
	}
	c.pages[token] = PageState{query, time.Now().Add(30 * time.Minute), seen}
}
