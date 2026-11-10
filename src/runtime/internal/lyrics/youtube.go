package lyrics

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"wisewave-runtime/internal/innertube"
)

type YouTubeProvider struct {
	httpClient *http.Client
	subtitles  bool
	music      *innertube.MusicClient
}

func NewYouTubeSubtitleProvider() *YouTubeProvider {
	return &YouTubeProvider{httpClient: &http.Client{Timeout: 5 * time.Second}, subtitles: true}
}
func NewYouTubeMusicProvider(client *innertube.MusicClient) *YouTubeProvider {
	return &YouTubeProvider{music: client}
}
func (p *YouTubeProvider) Name() string {
	if p.subtitles {
		return "youtube_subtitle"
	}
	return "youtube_music"
}

var lyricsVideoID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

func lyricsObject(value interface{}) map[string]interface{} {
	object, _ := value.(map[string]interface{})
	return object
}
func lyricsArray(value interface{}) []interface{} { array, _ := value.([]interface{}); return array }
func lyricsText(value interface{}) string {
	object := lyricsObject(value)
	if simple, ok := object["simpleText"].(string); ok {
		return simple
	}
	var result strings.Builder
	for _, run := range lyricsArray(object["runs"]) {
		text, _ := lyricsObject(run)["text"].(string)
		result.WriteString(text)
	}
	return result.String()
}
func lyricsNumber(value interface{}) int64 {
	switch number := value.(type) {
	case string:
		result, _ := strconv.ParseInt(number, 10, 64)
		return result
	case float64:
		return int64(number)
	}
	return 0
}

func (p *YouTubeProvider) request(method string, payload map[string]interface{}) (map[string]interface{}, error) {
	payload["context"] = map[string]interface{}{"client": map[string]interface{}{"clientName": "WEB", "clientVersion": "2.20260213.00.00", "hl": "en", "gl": "US"}}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequest(http.MethodPost, "https://music.youtube.com/youtubei/v1/"+method+"?key="+innertube.PlayerClients[3].APIKey, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", innertube.PlayerClients[3].UserAgent)
	request.Header.Set("Origin", "https://music.youtube.com")
	request.Header.Set("Referer", "https://music.youtube.com/")
	response, err := p.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("lyrics source unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lyrics source unavailable")
	}
	var root map[string]interface{}
	if err = json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&root); err != nil {
		return nil, fmt.Errorf("lyrics response unavailable")
	}
	return root, nil
}

func (p *YouTubeProvider) Fetch(meta TrackMeta) (*LyricsDocument, error) {
	if !lyricsVideoID.MatchString(meta.VideoID) {
		return nil, fmt.Errorf("video identifier unavailable")
	}
	if p.subtitles {
		return p.transcript(meta)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := p.music.GetLyrics(ctx, meta.VideoID)
	if err != nil {
		return nil, err
	}
	doc := &LyricsDocument{Source: "wisewave", Type: "plain", TrackName: meta.Title, ArtistName: meta.Artist, AlbumName: meta.Album, Duration: float64(meta.DurationSeconds), PlainLyrics: strings.TrimSpace(result.Description)}
	for _, line := range result.Timed {
		if text := strings.TrimSpace(line.Text); text != "" && line.Start >= 0 {
			doc.Lines = append(doc.Lines, Line{StartTimeMs: line.Start.Milliseconds(), Text: text})
		}
	}
	if len(doc.Lines) > 0 {
		sort.SliceStable(doc.Lines, func(i, j int) bool { return doc.Lines[i].StartTimeMs < doc.Lines[j].StartTimeMs })
		for i := range doc.Lines {
			if i+1 < len(doc.Lines) {
				doc.Lines[i].EndTimeMs = doc.Lines[i+1].StartTimeMs
			} else if meta.DurationMs > doc.Lines[i].StartTimeMs {
				doc.Lines[i].EndTimeMs = meta.DurationMs
			} else {
				doc.Lines[i].EndTimeMs = doc.Lines[i].StartTimeMs
			}
		}
		doc.Type = "synced"
		doc.SyncedLyrics = BuildSyncedLrc(doc.Lines)
		if doc.PlainLyrics == "" {
			doc.PlainLyrics = BuildPlainLyrics(doc.Lines)
		}
	}
	if doc.PlainLyrics == "" && doc.SyncedLyrics == "" {
		return nil, fmt.Errorf("lyrics unavailable")
	}
	return doc, nil
}

func (p *YouTubeProvider) transcript(meta TrackMeta) (*LyricsDocument, error) {
	params := base64.StdEncoding.EncodeToString(append([]byte{10, 11}, []byte(meta.VideoID)...))
	root, err := p.request("get_transcript", map[string]interface{}{"params": params})
	if err != nil {
		return nil, err
	}
	lines := []Line{}
	for _, action := range lyricsArray(root["actions"]) {
		panel := lyricsObject(lyricsObject(action)["updateEngagementPanelAction"])
		renderer := lyricsObject(lyricsObject(panel["content"])["transcriptRenderer"])
		body := lyricsObject(lyricsObject(renderer["body"])["transcriptBodyRenderer"])
		for _, group := range lyricsArray(body["cueGroups"]) {
			for _, cue := range lyricsArray(lyricsObject(lyricsObject(group)["transcriptCueGroupRenderer"])["cues"]) {
				item := lyricsObject(lyricsObject(cue)["transcriptCueRenderer"])
				text := strings.TrimSpace(strings.Trim(strings.TrimSpace(lyricsText(item["cue"])), "♪"))
				if text == "" {
					continue
				}
				start := lyricsNumber(item["startOffsetMs"])
				duration := lyricsNumber(item["durationMs"])
				lines = append(lines, Line{StartTimeMs: start, EndTimeMs: start + duration, Text: text})
			}
		}
	}
	if len(lines) == 0 {
		return nil, fmt.Errorf("subtitles unavailable")
	}
	sort.SliceStable(lines, func(i, j int) bool { return lines[i].StartTimeMs < lines[j].StartTimeMs })
	for i := range lines {
		if lines[i].EndTimeMs <= lines[i].StartTimeMs {
			if i+1 < len(lines) {
				lines[i].EndTimeMs = lines[i+1].StartTimeMs
			} else {
				lines[i].EndTimeMs = meta.DurationMs
			}
		}
	}
	return &LyricsDocument{Source: "wisewave", Type: "synced", TrackName: meta.Title, ArtistName: meta.Artist, AlbumName: meta.Album, Duration: float64(meta.DurationSeconds), Lines: lines, SyncedLyrics: BuildSyncedLrc(lines), PlainLyrics: BuildPlainLyrics(lines)}, nil
}
