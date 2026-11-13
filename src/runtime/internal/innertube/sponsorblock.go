package innertube

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

type SponsorSegment struct {
	Category   string     `json:"category"`
	ActionType string     `json:"actionType"`
	Interval   [2]float64 `json:"segment"`
	UUID       string     `json:"UUID"`
}

func (s SponsorSegment) Start() float64 {
	return s.Interval[0]
}

func (s SponsorSegment) End() float64 {
	return s.Interval[1]
}

type SponsorBlockClient struct {
	httpClient *http.Client
	baseURL    string
	mu         sync.RWMutex
	cache      map[string]sponsorCacheEntry
}

type sponsorCacheEntry struct {
	segments  []SponsorSegment
	expiresAt time.Time
}

func NewSponsorBlockClient() *SponsorBlockClient {
	return &SponsorBlockClient{
		httpClient: &http.Client{
			Timeout: 4 * time.Second,
		},
		baseURL: "https://sponsor.ajay.app",
		cache:   make(map[string]sponsorCacheEntry),
	}
}

var DefaultSponsorBlock = NewSponsorBlockClient()

func (s *SponsorBlockClient) GetSegments(ctx context.Context, videoID string) ([]SponsorSegment, error) {
	if videoID == "" {
		return nil, nil
	}

	s.mu.RLock()
	entry, exists := s.cache[videoID]
	s.mu.RUnlock()

	now := time.Now()
	if exists && now.Before(entry.expiresAt) {
		return entry.segments, nil
	}

	categories := `["sponsor","intro","outro","music_offtopic","selfpromo","preview"]`
	endpoint := fmt.Sprintf("%s/api/skipSegments?videoID=%s&categories=%s",
		s.baseURL,
		url.QueryEscape(videoID),
		url.QueryEscape(categories),
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "WiseWave/1.0 (github.com/Fristonn/WiseWave)")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		s.mu.Lock()
		s.cache[videoID] = sponsorCacheEntry{
			segments:  nil,
			expiresAt: now.Add(2 * time.Hour),
		}
		s.mu.Unlock()
		return nil, nil
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sponsorblock: status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}

	var segments []SponsorSegment
	if err := json.Unmarshal(body, &segments); err != nil {
		return nil, err
	}

	s.mu.Lock()
	if len(s.cache) > 500 {
		for k, v := range s.cache {
			if now.After(v.expiresAt) {
				delete(s.cache, k)
			}
		}
	}
	s.cache[videoID] = sponsorCacheEntry{
		segments:  segments,
		expiresAt: now.Add(2 * time.Hour),
	}
	s.mu.Unlock()

	return segments, nil
}
