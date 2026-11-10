package lyrics

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
	"wisewave-runtime/internal/innertube"
)

type cachedRecord struct {
	record    *Record
	expiresAt time.Time
}
type lyricsFlight struct {
	ready  chan struct{}
	record *Record
	err    error
}
type Service struct {
	providers []Provider
	cache     map[string]cachedRecord
	flights   map[string]*lyricsFlight
	cacheLock sync.RWMutex
}

func NewService(client *innertube.MusicClient) *Service {
	return &Service{providers: []Provider{NewYouLyPlusProvider(), NewPaxSenixProvider(), NewUnisonProvider(), NewBetterLyricsProvider(), NewSimpMusicProvider(), NewLrclibProvider(), NewKugouProvider(), NewLrcRedProvider(), NewAmllProvider(), NewYouTubeSubtitleProvider(), NewYouTubeMusicProvider(client)}, cache: make(map[string]cachedRecord), flights: make(map[string]*lyricsFlight)}
}

func (s *Service) FetchLyrics(title, artist, album string, durationSeconds int) (*Record, error) {
	return s.FetchLyricsForTrack(TrackMeta{Title: title, Artist: artist, Album: album, DurationSeconds: durationSeconds, DurationMs: int64(durationSeconds) * 1000})
}

func lyricsCacheKey(meta TrackMeta) string {
	normalize := func(value string) string { return strings.ToLower(strings.Join(strings.Fields(value), " ")) }
	value, _ := json.Marshal([]interface{}{normalize(meta.Title), normalize(meta.Artist), normalize(meta.Album), meta.DurationSeconds, meta.VideoID, meta.ISRC, meta.SpotifyID})
	return string(value)
}

func cloneRecord(record *Record) *Record {
	if record == nil {
		return nil
	}
	result := *record
	result.Lines = append([]Line(nil), record.Lines...)
	for i := range result.Lines {
		result.Lines[i].Syllables = append([]Syllable(nil), record.Lines[i].Syllables...)
	}
	return &result
}

func (s *Service) FetchLyricsForTrack(meta TrackMeta, refresh ...bool) (*Record, error) {
	meta.Title = strings.TrimSpace(meta.Title)
	meta.Artist = strings.TrimSpace(meta.Artist)
	if meta.Title == "" || meta.Artist == "" {
		return nil, fmt.Errorf("title and artist are required")
	}
	if meta.DurationMs == 0 {
		meta.DurationMs = int64(meta.DurationSeconds) * 1000
	}
	key := lyricsCacheKey(meta)
	force := len(refresh) > 0 && refresh[0]
	s.cacheLock.Lock()
	if !force {
		if cached, ok := s.cache[key]; ok && time.Now().Before(cached.expiresAt) {
			record := cloneRecord(cached.record)
			s.cacheLock.Unlock()
			return record, nil
		}
	}
	if s.flights == nil {
		s.flights = make(map[string]*lyricsFlight)
	}
	flight := s.flights[key]
	if force && flight != nil {
		select {
		case <-flight.ready:
			flight = nil
		default:
		}
	}
	if flight == nil {
		if len(s.flights) >= 32 {
			s.cacheLock.Unlock()
			return nil, fmt.Errorf("lyrics busy, please try again")
		}
		if force {
			delete(s.cache, key)
		}
		flight = &lyricsFlight{ready: make(chan struct{})}
		s.flights[key] = flight
		go s.collectLyrics(meta, key, flight)
	}
	s.cacheLock.Unlock()
	<-flight.ready
	return cloneRecord(flight.record), flight.err
}

func documentQuality(doc *LyricsDocument) int {
	if doc == nil {
		return 0
	}
	for _, line := range doc.Lines {
		if len(line.Syllables) > 0 {
			return 3
		}
	}
	if doc.SyncedLyrics != "" {
		return 2
	}
	if doc.PlainLyrics != "" || doc.Instrumental {
		return 1
	}
	return 0
}

func recordDocument(doc *LyricsDocument) *Record {
	return &Record{Source: "wisewave", Type: doc.Type, TrackName: doc.TrackName, ArtistName: doc.ArtistName, AlbumName: doc.AlbumName, Duration: doc.Duration, Instrumental: doc.Instrumental, PlainLyrics: doc.PlainLyrics, SyncedLyrics: doc.SyncedLyrics, Lines: doc.Lines}
}

func (s *Service) cacheDocument(key string, flight *lyricsFlight, doc *LyricsDocument, refining bool) {
	s.cacheLock.Lock()
	defer s.cacheLock.Unlock()
	if s.flights[key] != flight {
		return
	}
	if s.cache == nil {
		s.cache = make(map[string]cachedRecord)
	}
	if len(s.cache) >= 256 {
		for entry, cached := range s.cache {
			if time.Now().After(cached.expiresAt) {
				delete(s.cache, entry)
			}
		}
		if len(s.cache) >= 256 {
			for entry := range s.cache {
				delete(s.cache, entry)
				break
			}
		}
	}
	record := cloneRecord(recordDocument(doc))
	record.Refining = refining
	s.cache[key] = cachedRecord{record: record, expiresAt: time.Now().Add(24 * time.Hour)}
}

func (s *Service) collectLyrics(meta TrackMeta, key string, flight *lyricsFlight) {
	results := make(chan *LyricsDocument, len(s.providers))
	for _, provider := range s.providers {
		go func(provider Provider) {
			doc, err := provider.Fetch(meta)
			if err != nil {
				doc = nil
			}
			results <- doc
		}(provider)
	}
	deadline := time.NewTimer(12 * time.Second)
	defer deadline.Stop()
	var grace *time.Timer
	var graceChannel <-chan time.Time
	defer func() {
		if grace != nil {
			grace.Stop()
		}
		s.cacheLock.Lock()
		if s.flights[key] == flight {
			delete(s.flights, key)
		}
		s.cacheLock.Unlock()
	}()
	var best *LyricsDocument
	published := false
	remaining := len(s.providers)
	publish := func() {
		if published {
			return
		}
		published = true
		if best == nil {
			flight.err = fmt.Errorf("lyrics unavailable for this track")
		} else {
			flight.record = cloneRecord(recordDocument(best))
			flight.record.Refining = remaining > 0 && documentQuality(best) < 3
			s.cacheDocument(key, flight, best, flight.record.Refining)
		}
		close(flight.ready)
	}
	finish := func() {
		publish()
		if best != nil {
			s.cacheDocument(key, flight, best, false)
		}
	}
	for remaining > 0 {
		select {
		case doc := <-results:
			remaining--
			if documentQuality(doc) > documentQuality(best) {
				best = doc
				if best.TrackName == "" {
					best.TrackName = meta.Title
				}
				if best.ArtistName == "" {
					best.ArtistName = meta.Artist
				}
				if best.AlbumName == "" {
					best.AlbumName = meta.Album
				}
				if published {
					s.cacheDocument(key, flight, best, remaining > 0 && documentQuality(best) < 3)
				}
				if documentQuality(best) == 3 {
					finish()
					return
				}
				if !published && grace == nil {
					grace = time.NewTimer(400 * time.Millisecond)
					graceChannel = grace.C
				}
			}
		case <-graceChannel:
			publish()
			graceChannel = nil
		case <-deadline.C:
			finish()
			return
		}
	}
	finish()
}

func (s *Service) FetchDocument(meta TrackMeta) (*LyricsDocument, error) {
	record, err := s.FetchLyricsForTrack(meta)
	if err != nil {
		return nil, err
	}
	return &LyricsDocument{Source: "wisewave", Type: record.Type, TrackName: record.TrackName, ArtistName: record.ArtistName, AlbumName: record.AlbumName, Duration: record.Duration, Instrumental: record.Instrumental, PlainLyrics: record.PlainLyrics, SyncedLyrics: record.SyncedLyrics, Lines: record.Lines}, nil
}
