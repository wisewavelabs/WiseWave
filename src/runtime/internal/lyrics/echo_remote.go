package lyrics

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

var errRemoteLyrics = errors.New("lyrics unavailable")

type remoteLyricsProvider struct {
	name       string
	servers    []string
	httpClient *http.Client
}

func newRemoteLyricsProvider(name string, servers ...string) *remoteLyricsProvider {
	return &remoteLyricsProvider{name: name, servers: servers, httpClient: &http.Client{Timeout: 5 * time.Second}}
}

func NewYouLyPlusProvider() *remoteLyricsProvider {
	return newRemoteLyricsProvider("youlyplus", "https://lyricsplus.prjktla.my.id", "https://lyricsplus.atomix.one", "https://lyricsplus.binimum.org", "https://lyricsplus.prjktla.workers.dev", "https://lyricsplus-seven.vercel.app", "https://lyrics-plus-backend.vercel.app")
}
func NewPaxSenixProvider() *remoteLyricsProvider {
	return newRemoteLyricsProvider("paxsenix", "https://lyrics.paxsenix.org")
}
func NewUnisonProvider() *remoteLyricsProvider {
	return newRemoteLyricsProvider("unison", "https://unison.boidu.dev")
}
func NewBetterLyricsProvider() *remoteLyricsProvider {
	return newRemoteLyricsProvider("betterlyrics", "https://lyrics-api.boidu.dev")
}
func NewSimpMusicProvider() *remoteLyricsProvider {
	return newRemoteLyricsProvider("simpmusic", "https://api-lyrics.simpmusic.org", "https://vivi-yt-music-server.onrender.com")
}
func (p *remoteLyricsProvider) Name() string { return p.name }

func (p *remoteLyricsProvider) Fetch(meta TrackMeta) (*LyricsDocument, error) {
	if strings.TrimSpace(meta.Title) == "" || strings.TrimSpace(meta.Artist) == "" {
		return nil, errRemoteLyrics
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	switch p.name {
	case "youlyplus":
		return p.youlyplus(ctx, meta)
	case "paxsenix":
		return p.paxsenix(ctx, meta)
	case "unison":
		return p.unison(ctx, meta)
	case "betterlyrics":
		query := url.Values{"s": {meta.Title}, "a": {meta.Artist}}
		if meta.Album != "" {
			query.Set("al", meta.Album)
		}
		if meta.DurationSeconds > 0 {
			query.Set("d", strconv.Itoa(meta.DurationSeconds))
		}
		var response struct {
			TTML string `json:"ttml"`
		}
		if p.getJSON(ctx, p.servers[0], "/getLyrics", query, &response) != nil {
			return nil, errRemoteLyrics
		}
		return remoteLyricsDocument(meta, response.TTML)
	case "simpmusic":
		return p.simpmusic(ctx, meta)
	}
	return nil, errRemoteLyrics
}

func (p *remoteLyricsProvider) getJSON(ctx context.Context, base, path string, query url.Values, target any) error {
	endpoint, err := url.Parse(base + path)
	if err != nil {
		return errRemoteLyrics
	}
	endpoint.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return errRemoteLyrics
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "WiseWave/1.0")
	response, err := p.httpClient.Do(request)
	if err != nil {
		return errRemoteLyrics
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errRemoteLyrics
	}
	const limit = 8 * 1024 * 1024
	if response.ContentLength > limit {
		return errRemoteLyrics
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || len(body) > limit || json.Unmarshal(body, target) != nil {
		return errRemoteLyrics
	}
	return nil
}

type plusSyllable struct {
	Text         string `json:"text"`
	Time         *int64 `json:"time"`
	Duration     *int64 `json:"duration"`
	IsBackground bool   `json:"isBackground"`
}
type plusLine struct {
	Text     string         `json:"text"`
	Time     *int64         `json:"time"`
	Duration *int64         `json:"duration"`
	Syllabus []plusSyllable `json:"syllabus"`
}

func (p *remoteLyricsProvider) youlyplus(ctx context.Context, meta TrackMeta) (*LyricsDocument, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan *LyricsDocument, len(p.servers))
	for _, server := range p.servers {
		go func(server string) {
			var result *LyricsDocument
			defer func() { results <- result }()
			query := url.Values{"title": {meta.Title}, "artist": {meta.Artist}}
			if meta.DurationSeconds > 0 {
				query.Set("duration", strconv.Itoa(meta.DurationSeconds))
			}
			if meta.Album != "" {
				query.Set("album", meta.Album)
			}
			if meta.ISRC != "" {
				query.Set("isrc", meta.ISRC)
			}
			var response struct {
				TrackName    string     `json:"trackName"`
				ArtistName   string     `json:"artistName"`
				Duration     float64    `json:"duration"`
				SyncedLyrics string     `json:"syncedLyrics"`
				PlainLyrics  string     `json:"plainLyrics"`
				Lyrics       []plusLine `json:"lyrics"`
			}
			if p.getJSON(ctx, server, "/v2/lyrics/get", query, &response) != nil || !remoteMetadataMatches(meta, response.TrackName, response.ArtistName, response.Duration) {
				return
			}
			var lines []Line
			var plain []string
			for _, item := range response.Lyrics {
				if item.Time == nil || *item.Time < 0 {
					if item.Text != "" {
						plain = append(plain, item.Text)
					}
					continue
				}
				line := Line{StartTimeMs: *item.Time, Text: item.Text}
				if item.Duration != nil && *item.Duration > 0 {
					line.EndTimeMs = line.StartTimeMs + *item.Duration
				}
				var words strings.Builder
				for _, word := range item.Syllabus {
					words.WriteString(word.Text)
					if word.Time != nil && word.Duration != nil && *word.Time >= 0 && *word.Duration > 0 && word.Text != "" {
						line.Syllables = append(line.Syllables, Syllable{StartTimeMs: *word.Time, EndTimeMs: *word.Time + *word.Duration, Text: word.Text, IsBackground: word.IsBackground})
					}
				}
				if len(line.Syllables) > 0 {
					line.IsBackground = true
					for _, syllable := range line.Syllables {
						if !syllable.IsBackground {
							line.IsBackground = false
							break
						}
					}
				}
				if line.Text == "" {
					line.Text = words.String()
				}
				lines = append(lines, line)
			}
			if len(lines) > 0 {
				result, _ = remoteLinesDocument(meta, lines)
				return
			}
			for _, content := range []string{response.SyncedLyrics, response.PlainLyrics, strings.Join(plain, "\n")} {
				if doc, err := remoteLyricsDocument(meta, content); err == nil {
					result = doc
					return
				}
			}
		}(server)
	}
	for range p.servers {
		select {
		case doc := <-results:
			if doc != nil {
				return doc, nil
			}
		case <-ctx.Done():
			return nil, errRemoteLyrics
		}
	}
	return nil, errRemoteLyrics
}

type unisonEntry struct {
	VideoID  string  `json:"videoId"`
	Song     string  `json:"song"`
	Artist   string  `json:"artist"`
	Lyrics   string  `json:"lyrics"`
	Duration float64 `json:"duration"`
}

func (p *remoteLyricsProvider) unison(ctx context.Context, meta TrackMeta) (*LyricsDocument, error) {
	queries := []url.Values{}
	if validRemoteVideoID(meta.VideoID) {
		queries = append(queries, url.Values{"v": {meta.VideoID}})
	}
	query := url.Values{"song": {meta.Title}, "artist": {meta.Artist}}
	if meta.Album != "" {
		query.Set("album", meta.Album)
	}
	if meta.DurationSeconds > 0 {
		query.Set("duration", strconv.Itoa(meta.DurationSeconds))
	}
	queries = append(queries, query)
	for _, query := range queries {
		var response struct {
			Success bool         `json:"success"`
			Data    *unisonEntry `json:"data"`
		}
		if p.getJSON(ctx, p.servers[0], "/lyrics", query, &response) != nil || !response.Success || response.Data == nil {
			continue
		}
		entry := response.Data
		if query.Get("v") != "" && entry.VideoID != "" && entry.VideoID != meta.VideoID {
			continue
		}
		if !remoteMetadataMatches(meta, entry.Song, entry.Artist, entry.Duration) {
			continue
		}
		if doc, err := remoteLyricsDocument(meta, entry.Lyrics); err == nil {
			return doc, nil
		}
	}
	return nil, errRemoteLyrics
}

func (p *remoteLyricsProvider) simpmusic(ctx context.Context, meta TrackMeta) (*LyricsDocument, error) {
	if !validRemoteVideoID(meta.VideoID) {
		return nil, errRemoteLyrics
	}
	for _, server := range p.servers {
		var response struct {
			Type string `json:"type"`
			Data []struct {
				VideoID  string  `json:"videoId"`
				Title    string  `json:"songTitle"`
				Artist   string  `json:"artistName"`
				Duration float64 `json:"durationSeconds"`
				Rich     string  `json:"richSyncLyrics"`
				Synced   string  `json:"syncedLyrics"`
				Plain    string  `json:"plainLyric"`
			} `json:"data"`
		}
		if p.getJSON(ctx, server, "/v1/"+meta.VideoID, nil, &response) != nil {
			continue
		}
		if response.Type != "success" {
			return nil, errRemoteLyrics
		}
		sort.SliceStable(response.Data, func(i, j int) bool {
			return math.Abs(response.Data[i].Duration-float64(meta.DurationSeconds)) < math.Abs(response.Data[j].Duration-float64(meta.DurationSeconds))
		})
		for _, entry := range response.Data {
			if entry.VideoID != "" && entry.VideoID != meta.VideoID {
				continue
			}
			if !remoteMetadataMatches(meta, entry.Title, entry.Artist, entry.Duration) {
				continue
			}
			for _, content := range []string{entry.Rich, entry.Synced, entry.Plain} {
				if doc, err := remoteLyricsDocument(meta, content); err == nil {
					return doc, nil
				}
			}
		}
		return nil, errRemoteLyrics
	}
	return nil, errRemoteLyrics
}

type paxWord struct {
	Text      string `json:"text"`
	Timestamp *int64 `json:"timestamp"`
	Endtime   int64  `json:"endtime"`
	Part      bool   `json:"part"`
}
type paxLine struct {
	Timestamp      *int64    `json:"timestamp"`
	Endtime        int64     `json:"endtime"`
	Text           []paxWord `json:"text"`
	Background     bool      `json:"background"`
	BackgroundText []paxWord `json:"backgroundText"`
}

func (p *remoteLyricsProvider) paxsenix(ctx context.Context, meta TrackMeta) (*LyricsDocument, error) {
	var candidates []struct {
		ID        string  `json:"id"`
		SongName  string  `json:"songName"`
		TrackName string  `json:"trackName"`
		Artist    string  `json:"artistName"`
		Duration  float64 `json:"duration"`
	}
	queries := []string{meta.Title + " " + meta.Artist, meta.Title}
	if meta.Album != "" {
		queries = append(queries, meta.Title+" "+meta.Artist+" "+meta.Album)
	}
	for _, query := range queries {
		candidates = nil
		if p.getJSON(ctx, p.servers[0], "/apple-music/search", url.Values{"q": {query}}, &candidates) != nil {
			continue
		}
		filtered := candidates[:0]
		for _, candidate := range candidates {
			title := candidate.TrackName
			if title == "" {
				title = candidate.SongName
			}
			if candidate.ID != "" && title != "" && candidate.Artist != "" && remoteMetadataMatches(meta, title, candidate.Artist, candidate.Duration/1000) {
				filtered = append(filtered, candidate)
			}
		}
		candidates = filtered
		if len(candidates) > 0 {
			break
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		return math.Abs(candidates[i].Duration/1000-float64(meta.DurationSeconds)) < math.Abs(candidates[j].Duration/1000-float64(meta.DurationSeconds))
	})
	var fallback *LyricsDocument
	for index, candidate := range candidates {
		if index >= 5 {
			break
		}
		var response struct {
			Type    string    `json:"type"`
			TTML    string    `json:"ttmlContent"`
			ELRC    string    `json:"elrc"`
			Multi   string    `json:"elrcMultiPerson"`
			Plain   string    `json:"plain"`
			Content []paxLine `json:"content"`
		}
		if p.getJSON(ctx, p.servers[0], "/apple-music/lyrics", url.Values{"id": {candidate.ID}}, &response) != nil {
			continue
		}
		var doc *LyricsDocument
		for _, content := range []string{response.TTML, response.Multi, response.ELRC} {
			if parsed, err := remoteLyricsDocument(meta, content); err == nil {
				doc = parsed
				break
			}
		}
		if doc == nil {
			var lines []Line
			var plain []string
			for _, item := range response.Content {
				line := remotePaxLine(item.Timestamp, item.Endtime, item.Text, false, response.Type == "Syllable")
				if response.Type == "Syllable" && item.Timestamp != nil && *item.Timestamp >= 0 {
					lines = append(lines, line)
				} else {
					plain = append(plain, line.Text)
				}
				if len(item.BackgroundText) > 0 {
					background := remotePaxLine(item.Timestamp, item.Endtime, item.BackgroundText, true, response.Type == "Syllable")
					if response.Type == "Syllable" && item.Timestamp != nil && *item.Timestamp >= 0 {
						lines = append(lines, background)
					} else {
						plain = append(plain, background.Text)
					}
				}
			}
			if len(lines) > 0 {
				doc, _ = remoteLinesDocument(meta, lines)
			} else {
				doc, _ = remoteLyricsDocument(meta, strings.Join(plain, "\n"))
			}
		}
		if doc == nil {
			doc, _ = remoteLyricsDocument(meta, response.Plain)
		}
		if doc != nil {
			if doc.Type == "syllable" {
				return doc, nil
			}
			if fallback == nil || (fallback.Type == "plain" && doc.Type == "line") {
				fallback = doc
			}
		}
	}
	if fallback != nil {
		return fallback, nil
	}
	return nil, errRemoteLyrics
}

func remotePaxLine(start *int64, end int64, words []paxWord, background, timed bool) Line {
	line := Line{EndTimeMs: end, IsBackground: background}
	if start != nil {
		line.StartTimeMs = *start
	}
	var text strings.Builder
	for index, word := range words {
		if index > 0 && !word.Part && text.Len() > 0 && !wordBoundaryAlreadyPresent(text.String(), word.Text) {
			text.WriteByte(' ')
		}
		text.WriteString(word.Text)
		if timed && word.Timestamp != nil && *word.Timestamp >= 0 && word.Endtime > *word.Timestamp && word.Text != "" {
			line.Syllables = append(line.Syllables, Syllable{StartTimeMs: *word.Timestamp, EndTimeMs: word.Endtime, Text: word.Text, AppendToPrevious: word.Part, IsBackground: background})
		}
	}
	line.Text = text.String()
	return line
}

func wordBoundaryAlreadyPresent(previous, next string) bool {
	return strings.HasSuffix(previous, " ") || strings.HasPrefix(next, " ") || next == ""
}

func remoteMetadataMatches(meta TrackMeta, title, artist string, duration float64) bool {
	normalize := func(value string) string {
		return strings.Map(func(r rune) rune {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				return unicode.ToLower(r)
			}
			return -1
		}, strings.TrimSpace(value))
	}
	if title != "" && normalize(SanitizeTitle(title)) != normalize(SanitizeTitle(meta.Title)) {
		return false
	}
	if artist != "" {
		actual, wanted := normalize(artist), normalize(meta.Artist)
		if actual == "" || wanted == "" || (!strings.Contains(actual, wanted) && !strings.Contains(wanted, actual)) {
			return false
		}
	}
	return duration <= 0 || meta.DurationSeconds <= 0 || math.Abs(duration-float64(meta.DurationSeconds)) <= 10
}

var remoteVideoPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

func validRemoteVideoID(id string) bool { return remoteVideoPattern.MatchString(id) }

var remoteAgentPattern = regexp.MustCompile(`\{(?:bg|agent:[^}]+)\}`)

func remoteLyricsDocument(meta TrackMeta, content string) (*LyricsDocument, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, errRemoteLyrics
	}
	if strings.HasPrefix(content, "<") && (strings.Contains(content, "<tt") || strings.Contains(content, ":tt")) {
		lines, _, err := ParseTtml(content)
		if err != nil {
			return nil, errRemoteLyrics
		}
		return remoteLinesDocument(meta, lines)
	}
	if strings.HasPrefix(content, "<html") || strings.HasPrefix(content, "<!DOCTYPE") || strings.HasPrefix(content, "{") {
		return nil, errRemoteLyrics
	}
	var lines []Line
	for _, raw := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		raw = strings.TrimSpace(raw)
		timestamp := lrcTimestampPattern.FindStringIndex(raw)
		if timestamp == nil || timestamp[0] != 0 {
			continue
		}
		start, ok := ParseLrcTimestamp(raw[:timestamp[1]])
		if !ok {
			continue
		}
		text := strings.TrimSpace(raw[timestamp[1]:])
		background := strings.Contains(text, "{bg}")
		text = remoteAgentPattern.ReplaceAllString(text, "")
		cleanText := strings.TrimSpace(wordTimestampPattern.ReplaceAllString(text, ""))
		if cleanText == "" || cleanText == "♪" {
			if len(lines) > 0 && lines[len(lines)-1].EndTimeMs == 0 {
				lines[len(lines)-1].EndTimeMs = start
			}
			lines = append(lines, Line{StartTimeMs: start})
			continue
		}
		matches := wordTimestampPattern.FindAllStringSubmatchIndex(text, -1)
		line := Line{StartTimeMs: start, IsBackground: background, Text: cleanText}
		for index, match := range matches {
			if index+1 >= len(matches) {
				break
			}
			next := matches[index+1]
			wordStart, startOK := ParseLrcTimestamp("[" + text[match[2]:match[3]] + "]")
			wordEnd, endOK := ParseLrcTimestamp("[" + text[next[2]:next[3]] + "]")
			word := text[match[1]:next[0]]
			if startOK && endOK && wordEnd > wordStart && strings.TrimSpace(word) != "" {
				line.Syllables = append(line.Syllables, Syllable{StartTimeMs: wordStart, EndTimeMs: wordEnd, Text: word})
			}
		}
		if len(matches) > 0 {
			last := matches[len(matches)-1]
			if strings.TrimSpace(text[last[1]:]) == "" {
				line.EndTimeMs, _ = ParseLrcTimestamp("[" + text[last[2]:last[3]] + "]")
			}
		}
		lines = append(lines, line)
	}
	if len(lines) > 0 {
		return remoteLinesDocument(meta, lines)
	}
	if strings.Contains(content, "[00:") || strings.Contains(content, "<tt") {
		return nil, errRemoteLyrics
	}
	return &LyricsDocument{Source: "wisewave", Type: "plain", TrackName: meta.Title, ArtistName: meta.Artist, AlbumName: meta.Album, Duration: float64(meta.DurationSeconds), PlainLyrics: content}, nil
}

func remoteLinesDocument(meta TrackMeta, lines []Line) (*LyricsDocument, error) {
	if len(lines) == 0 {
		return nil, errRemoteLyrics
	}
	hasText := false
	kind := "line"
	for _, line := range lines {
		hasText = hasText || strings.TrimSpace(line.Text) != ""
		if len(line.Syllables) > 0 {
			kind = "syllable"
		}
	}
	if !hasText {
		return nil, errRemoteLyrics
	}
	return &LyricsDocument{Source: "wisewave", Type: kind, TrackName: meta.Title, ArtistName: meta.Artist, AlbumName: meta.Album, Duration: float64(meta.DurationSeconds), Lines: lines, PlainLyrics: BuildPlainLyrics(lines), SyncedLyrics: BuildSyncedLrc(lines)}, nil
}
