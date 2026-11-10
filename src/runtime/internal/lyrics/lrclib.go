package lyrics

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type LrclibProvider struct {
	httpClient  *http.Client
	requestLock sync.Mutex
	nextRequest time.Time
}

type lrclibResponseBody struct {
	io.ReadCloser
	release func()
	once    sync.Once
}

func (body *lrclibResponseBody) Close() error {
	err := body.ReadCloser.Close()
	body.once.Do(body.release)
	return err
}

func (l *LrclibProvider) request(req *http.Request) (*http.Response, error) {
	l.requestLock.Lock()
	if wait := time.Until(l.nextRequest); wait > 0 {
		time.Sleep(wait)
	}
	resp, err := l.httpClient.Do(req)
	if err != nil {
		l.nextRequest = time.Now().Add(300 * time.Millisecond)
		l.requestLock.Unlock()
		return nil, err
	}
	l.nextRequest = time.Now().Add(300 * time.Millisecond)
	if resp.StatusCode == http.StatusTooManyRequests {
		value := resp.Header.Get("Retry-After")
		if seconds, parseErr := strconv.ParseInt(value, 10, 64); parseErr == nil && seconds > 0 {
			l.nextRequest = time.Now().Add(time.Duration(seconds) * time.Second)
		} else if retryAt, parseErr := http.ParseTime(value); parseErr == nil && retryAt.After(l.nextRequest) {
			l.nextRequest = retryAt
		}
	}
	resp.Body = &lrclibResponseBody{ReadCloser: resp.Body, release: func() {
		if next := time.Now().Add(300 * time.Millisecond); next.After(l.nextRequest) {
			l.nextRequest = next
		}
		l.requestLock.Unlock()
	}}
	return resp, err
}

func NewLrclibProvider() *LrclibProvider {
	return &LrclibProvider{
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (l *LrclibProvider) Name() string {
	return "lrclib"
}

type lrclibResult struct {
	ID           int64   `json:"id"`
	TrackName    string  `json:"trackName"`
	ArtistName   string  `json:"artistName"`
	AlbumName    string  `json:"albumName"`
	Duration     float64 `json:"duration"`
	Instrumental bool    `json:"instrumental"`
	PlainLyrics  string  `json:"plainLyrics"`
	SyncedLyrics string  `json:"syncedLyrics"`
}

func (l *LrclibProvider) Fetch(meta TrackMeta) (*LyricsDocument, error) {
	if meta.Title == "" || meta.Artist == "" {
		return nil, fmt.Errorf("title and artist are required")
	}

	record, err := l.getExact(meta.Title, meta.Artist, meta.Album, meta.DurationSeconds)
	if err == nil && record != nil && (record.SyncedLyrics != "" || record.PlainLyrics != "" || record.Instrumental) {
		return l.toDocument(record), nil
	}

	record, err = l.getExact(meta.Title, meta.Artist, "", meta.DurationSeconds)
	if err == nil && record != nil && (record.SyncedLyrics != "" || record.PlainLyrics != "" || record.Instrumental) {
		return l.toDocument(record), nil
	}

	cleanedTitle := SanitizeTitle(meta.Title)
	if cleanedTitle != meta.Title {
		record, err = l.getExact(cleanedTitle, meta.Artist, "", meta.DurationSeconds)
		if err == nil && record != nil && (record.SyncedLyrics != "" || record.PlainLyrics != "" || record.Instrumental) {
			return l.toDocument(record), nil
		}
	}

	record, err = l.search(cleanedTitle, meta.Artist)
	if err == nil && record != nil {
		return l.toDocument(record), nil
	}

	return nil, fmt.Errorf("no lrclib lyrics found")
}

func (l *LrclibProvider) toDocument(res *lrclibResult) *LyricsDocument {
	var lines []Line
	if res.SyncedLyrics != "" {
		rawLines := strings.Split(strings.ReplaceAll(res.SyncedLyrics, "\r\n", "\n"), "\n")
		for _, rawLine := range rawLines {
			rawLine = strings.TrimSpace(rawLine)
			if rawLine == "" {
				continue
			}
			tsMatch := lrcTimestampPattern.FindString(rawLine)
			if tsMatch == "" {
				continue
			}
			startMs, ok := ParseLrcTimestamp(tsMatch)
			if !ok {
				continue
			}
			text := strings.TrimSpace(rawLine[len(tsMatch):])
			if text == "" || text == "♪" {
				if len(lines) > 0 && lines[len(lines)-1].EndTimeMs == 0 {
					lines[len(lines)-1].EndTimeMs = startMs
				}
				text = ""
			}
			lines = append(lines, Line{
				StartTimeMs: startMs,
				Text:        text,
			})
		}
	}

	docType := "plain"
	for _, line := range lines {
		if strings.TrimSpace(line.Text) != "" {
			docType = "line"
			break
		}
	}

	return &LyricsDocument{
		Source:       "lrclib",
		Type:         docType,
		TrackName:    res.TrackName,
		ArtistName:   res.ArtistName,
		AlbumName:    res.AlbumName,
		Duration:     res.Duration,
		Instrumental: res.Instrumental,
		PlainLyrics:  res.PlainLyrics,
		SyncedLyrics: res.SyncedLyrics,
		Lines:        lines,
	}
}

func (l *LrclibProvider) getExact(title, artist, album string, durationSeconds int) (*lrclibResult, error) {
	u, _ := url.Parse("https://lrclib.net/api/get")
	q := u.Query()
	q.Set("track_name", title)
	q.Set("artist_name", artist)
	if album != "" {
		q.Set("album_name", album)
	}
	if durationSeconds > 0 {
		q.Set("duration", fmt.Sprintf("%d", durationSeconds))
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "WiseWave/1.0 (https://wisewave.me)")

	resp, err := l.request(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lrclib exact match returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var rec lrclibResult
	if err := json.Unmarshal(body, &rec); err != nil {
		return nil, err
	}

	return &rec, nil
}

func (l *LrclibProvider) search(title, artist string) (*lrclibResult, error) {
	u, _ := url.Parse("https://lrclib.net/api/search")
	q := u.Query()
	q.Set("track_name", title)
	q.Set("artist_name", artist)
	u.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "WiseWave/1.0 (https://wisewave.me)")

	resp, err := l.request(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lrclib search returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var results []lrclibResult
	if err := json.Unmarshal(body, &results); err != nil {
		return nil, err
	}

	if len(results) == 0 {
		return nil, fmt.Errorf("no lyrics found for %s by %s", title, artist)
	}

	for _, item := range results {
		if item.SyncedLyrics != "" {
			return &item, nil
		}
	}

	return &results[0], nil
}
