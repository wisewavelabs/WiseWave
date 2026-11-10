package cache

import (
	"sync"
	"time"
	"wisewave-runtime/internal/innertube"
)

type CacheEntry struct {
	Stream    innertube.ResolvedAudioStream
	CachedAt  time.Time
	ExpiresAt time.Time
}

type StreamCache struct {
	mu      sync.RWMutex
	entries map[string]CacheEntry
}

func NewStreamCache() *StreamCache {
	return &StreamCache{
		entries: make(map[string]CacheEntry),
	}
}

const (
	defaultFallbackTTL = 15 * time.Minute
	expirationMargin   = 2 * time.Minute
	maxCacheEntries    = 256
)

func (c *StreamCache) Get(videoID string) (*innertube.ResolvedAudioStream, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, exists := c.entries[videoID]
	if !exists {
		return nil, false
	}

	if time.Now().After(entry.ExpiresAt) {
		delete(c.entries, videoID)
		return nil, false
	}

	stream := entry.Stream
	return &stream, true
}

func (c *StreamCache) Put(videoID string, stream innertube.ResolvedAudioStream) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	var expiresAt time.Time

	if stream.ExpiresAtMs > 0 {
		exp := time.UnixMilli(stream.ExpiresAtMs)
		if exp.Before(now) {
			return
		}
		if exp.Sub(now) > expirationMargin {
			expiresAt = exp.Add(-expirationMargin)
		} else {
			expiresAt = exp
		}
	} else {
		expiresAt = now.Add(defaultFallbackTTL)
	}

	if len(c.entries) >= maxCacheEntries {
		for id, ent := range c.entries {
			if now.After(ent.ExpiresAt) {
				delete(c.entries, id)
			}
		}
		if len(c.entries) >= maxCacheEntries {
			for id := range c.entries {
				delete(c.entries, id)
				break
			}
		}
	}

	c.entries[videoID] = CacheEntry{
		Stream:    stream,
		CachedAt:  now,
		ExpiresAt: expiresAt,
	}
}

func (c *StreamCache) Invalidate(videoID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, videoID)
}

