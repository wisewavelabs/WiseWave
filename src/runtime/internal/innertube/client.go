package innertube

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"wisewave-runtime/internal/models"
	"wisewave-runtime/internal/search"
)

type PlayerClient struct {
	Name      string
	Version   string
	APIKey    string
	UserAgent string
	OSName    string
	OSVersion string
}

var PlayerClients = []PlayerClient{
	{
		Name:      "ANDROID_VR",
		Version:   "1.65.10",
		APIKey:    "AIzaSyD-p045F_WzU-vA_YgX20SCx4KAo",
		UserAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
		OSName:    "Android",
		OSVersion: "12",
	},
	{
		Name:      "TVHTML5",
		Version:   "7.20260308.08.00",
		APIKey:    "AIzaSyAO_FJ2SlqAz8GlBg1fA54p0wDE7Xk80mU",
		UserAgent: "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/76.0.3809.146 TV Safari/537.36",
	},
	{
		Name:      "IOS_MUSIC",
		Version:   "7.27.0",
		APIKey:    "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc",
		UserAgent: "com.google.ios.youtubemusic/7.27.0 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)",
		OSName:    "iOS",
		OSVersion: "17.5.1",
	},
	{
		Name:      "WEB_REMIX",
		Version:   "1.20260707.12.00",
		APIKey:    "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30",
		UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
	},
}

type Client struct {
	*MusicClient
	httpClient       *http.Client
	clientPreference sync.RWMutex
	preferredClient  string
	searchOnce       sync.Once
	search           *search.Engine
	flights          singleflightGroup
}

func NewClient() *Client {
	return NewClientWithTokens(nil)
}

func NewClientWithTokens(tokens func(context.Context, string, string) (string, string, error)) *Client {
	return &Client{
		MusicClient: NewMusicClient(MusicOptions{Tokens: tokens}),
		httpClient: &http.Client{
			Timeout: 12 * time.Second,
		},
	}
}

type ResolvedAudioStream struct {
	VideoID       string
	URL           string
	MimeType      string
	Bitrate       int
	Itag          int
	DurationMs    int64
	ContentLength int64
	ExpiresAtMs   int64
	LoudnessDB    float64
	Codec         string
	IsHLS         bool
}

func (c *Client) ResolveAudioStream(videoID string) (*ResolvedAudioStream, error) {
	return c.ResolveAudio(context.Background(), videoID, StreamOptions{
		PreferredCodec: CodecAny,
		Validate:       true,
	})
}

func (client *Client) Search(query string) ([]models.Track, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return client.SearchContext(ctx, query)
}

func (client *Client) searchEngine() *search.Engine {
	client.searchOnce.Do(func() { client.search = search.New(client.retrieveSearch) })
	return client.search
}

func (client *Client) SearchContext(ctx context.Context, query string) ([]models.Track, error) {
	return client.searchEngine().SearchWithRanker(ctx, query, client.MusicClient.searchState.Ranker())
}

func (client *Client) LocalSearchSuggestions(query string) []string {
	return client.searchEngine().Suggestions(query, 8)
}

func (client *Client) retrieveSearch(ctx context.Context, query string) ([]models.Track, error) {
	raw, err := client.MusicClient.execute(ctx, "search", map[string]any{"query": query, "params": "EgWKAQIIAWoKEAkQBRAKEAMQBA=="})
	if err != nil {
		return nil, err
	}
	tracks, err := parseSearchResponse(raw)
	if err != nil {
		return nil, err
	}
	token := continuationToken(decodeResponse(raw))
	if len(tracks) < 60 && token != "" {
		next, nextErr := client.MusicClient.execute(ctx, "search", map[string]any{"continuation": token})
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if nextErr == nil {
			more, parseErr := parseSearchResponse(next)
			if parseErr == nil {
				tracks = append(tracks, more...)
			}
		}
	}
	return tracks, nil
}

func parseSearchResponse(data []byte) ([]models.Track, error) {
	var root interface{}
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, err
	}

	var tracks []models.Track
	seen := map[string]bool{}
	var walk func(interface{})
	walk = func(value interface{}) {
		switch node := value.(type) {
		case map[string]interface{}:
			if renderer, ok := node["musicResponsiveListItemRenderer"].(map[string]interface{}); ok {
				if track := extractTrackFromRenderer(renderer); track != nil && track.ID != "" && !seen[track.ID] {
					seen[track.ID] = true
					tracks = append(tracks, *track)
				}
			}
			keys := make([]string, 0, len(node))
			for key := range node {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				walk(node[key])
			}
		case []interface{}:
			for _, child := range node {
				walk(child)
			}
		}
	}
	walk(root)
	return tracks, nil
}

func extractTrackFromRenderer(renderer map[string]interface{}) *models.Track {
	playNav, ok := renderer["playlistItemData"].(map[string]interface{})
	var videoID string
	if ok {
		videoID, _ = playNav["videoId"].(string)
	}

	flexCols, ok := renderer["flexColumns"].([]interface{})
	if !ok || len(flexCols) < 2 {
		return nil
	}

	col0 := object(object(flexCols[0])["musicResponsiveListItemFlexColumnRenderer"])
	col1 := object(object(flexCols[1])["musicResponsiveListItemFlexColumnRenderer"])

	title := extractTextFromColumn(col0)
	metadata := parseByline(col1["text"])

	if title == "" {
		return nil
	}

	for _, column := range flexCols[2:] {
		entry := object(object(column)["musicResponsiveListItemFlexColumnRenderer"])
		additional := parseByline(entry["text"])
		if additional.albumID != "" {
			metadata.album, metadata.albumID = additional.album, additional.albumID
		}
	}

	durationText, durationSeconds := extractDurationFromRenderer(renderer)

	var artworkURL string
	if thumbnail, ok := renderer["thumbnail"].(map[string]interface{}); ok {
		if thumbRenderer, ok := thumbnail["musicThumbnailRenderer"].(map[string]interface{}); ok {
			if thumbObj, ok := thumbRenderer["thumbnail"].(map[string]interface{}); ok {
				if thumbs, ok := thumbObj["thumbnails"].([]interface{}); ok && len(thumbs) > 0 {
					last := object(thumbs[len(thumbs)-1])
					artworkURL, _ = last["url"].(string)
				}
			}
		}
	}

	if videoID == "" {
		if navEndpoint, ok := renderer["navigationEndpoint"].(map[string]interface{}); ok {
			if watch, ok := navEndpoint["watchEndpoint"].(map[string]interface{}); ok {
				videoID, _ = watch["videoId"].(string)
			}
		}
	}

	if videoID == "" {
		return nil
	}

	return &models.Track{
		ID:              videoID,
		Title:           title,
		Artist:          metadata.artist,
		ArtistID:        metadata.artistID,
		Album:           metadata.album,
		AlbumID:         metadata.albumID,
		Duration:        durationText,
		DurationSeconds: durationSeconds,
		AlbumArtURL:     UpgradeArtworkURL(artworkURL),
		StreamURL:       fmt.Sprintf("/api/v1/stream/%s", videoID),
		IsFavorite:      false,
	}
}

func extractTextFromColumn(col map[string]interface{}) string {
	textObj, ok := col["text"].(map[string]interface{})
	if !ok {
		return ""
	}
	if text, ok := textObj["simpleText"].(string); ok {
		return strings.TrimSpace(text)
	}
	runs, ok := textObj["runs"].([]interface{})
	if !ok || len(runs) == 0 {
		return ""
	}
	var text strings.Builder
	for _, run := range runs {
		if value, ok := object(run)["text"].(string); ok {
			text.WriteString(value)
		}
	}
	return strings.TrimSpace(text.String())
}

func extractDurationFromRenderer(renderer map[string]interface{}) (string, int) {
	if text := strings.TrimSpace(extractTextValue(renderer["lengthText"])); isDurationTextValue(text) {
		return text, parseDurationSeconds(text)
	}
	if fixedCols, ok := renderer["fixedColumns"].([]interface{}); ok {
		for _, column := range fixedCols {
			fcol := object(object(column)["musicResponsiveListItemFixedColumnRenderer"])
			text := strings.TrimSpace(extractTextFromColumn(fcol))
			if isDurationTextValue(text) {
				return text, parseDurationSeconds(text)
			}
		}
	}
	if flexCols, ok := renderer["flexColumns"].([]interface{}); ok {
		for index := len(flexCols) - 1; index >= 0; index-- {
			entry := object(object(flexCols[index])["musicResponsiveListItemFlexColumnRenderer"])
			if text := durationFromTextObject(entry["text"]); text != "" {
				return text, parseDurationSeconds(text)
			}
		}
	}
	if text := trailingDurationText(extractTextValue(renderer["subtitle"])); text != "" {
		return text, parseDurationSeconds(text)
	}
	if text := trailingDurationText(extractTextValue(renderer["longBylineText"])); text != "" {
		return text, parseDurationSeconds(text)
	}
	if text := trailingDurationText(extractTextValue(renderer["shortBylineText"])); text != "" {
		return text, parseDurationSeconds(text)
	}
	return "", 0
}

func durationFromTextObject(value interface{}) string {
	textObj := object(value)
	if textObj == nil {
		return ""
	}
	if text, ok := textObj["simpleText"].(string); ok {
		text = strings.TrimSpace(text)
		if isDurationTextValue(text) {
			return text
		}
	}
	runs, ok := textObj["runs"].([]interface{})
	if !ok {
		return ""
	}
	for index := len(runs) - 1; index >= 0; index-- {
		run := object(runs[index])
		if run == nil || run["navigationEndpoint"] != nil {
			continue
		}
		text, _ := run["text"].(string)
		text = strings.TrimSpace(text)
		if isDurationTextValue(text) {
			return text
		}
	}
	return ""
}

func trailingDurationText(subtitle string) string {
	parts := strings.Split(subtitle, "•")
	for index := len(parts) - 1; index >= 0; index-- {
		text := strings.TrimSpace(parts[index])
		if isDurationTextValue(text) {
			return text
		}
	}
	return ""
}

func extractTextValue(value interface{}) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	textObj := object(value)
	if textObj == nil {
		return ""
	}
	if text, ok := textObj["simpleText"].(string); ok {
		return strings.TrimSpace(text)
	}
	runs, ok := textObj["runs"].([]interface{})
	if !ok || len(runs) == 0 {
		return ""
	}
	var text strings.Builder
	for _, run := range runs {
		if value, ok := object(run)["text"].(string); ok {
			text.WriteString(value)
		}
	}
	return strings.TrimSpace(text.String())
}

func isDurationTextValue(text string) bool {
	parts := strings.Split(text, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return false
	}
	for _, part := range parts {
		if part == "" || len(part) > 2 {
			return false
		}
		for _, digit := range part {
			if digit < '0' || digit > '9' {
				return false
			}
		}
	}
	return true
}

func parseDurationSeconds(text string) int {
	parts := strings.Split(text, ":")
	if len(parts) == 2 {
		m, _ := strconv.Atoi(parts[0])
		s, _ := strconv.Atoi(parts[1])
		return m*60 + s
	}
	if len(parts) == 3 {
		h, _ := strconv.Atoi(parts[0])
		m, _ := strconv.Atoi(parts[1])
		s, _ := strconv.Atoi(parts[2])
		return h*3600 + m*60 + s
	}
	return 0
}

var TitleCleanRegex = regexp.MustCompile(`(?i)\s*[\(\[](feat\.|ft\.|official|video|audio|remastered|lyrics)[\s\S]*?[\)\]]`)

func CleanTitle(title string) string {
	cleaned := TitleCleanRegex.ReplaceAllString(title, "")
	return strings.TrimSpace(cleaned)
}

var googleUserContentSizeRegex = regexp.MustCompile(`=w\d+-h\d+[^?]*`)
var googleUserContentSRegex = regexp.MustCompile(`=s\d+[^?]*`)

func UpgradeArtworkURL(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	if strings.Contains(rawURL, "googleusercontent.com") || strings.Contains(rawURL, "ggpht.com") {
		if googleUserContentSizeRegex.MatchString(rawURL) {
			rawURL = googleUserContentSizeRegex.ReplaceAllString(rawURL, "=w1200-h1200-l90-rj")
		} else if googleUserContentSRegex.MatchString(rawURL) {
			rawURL = googleUserContentSRegex.ReplaceAllString(rawURL, "=s1200-l90-rj")
		}
	}
	if strings.Contains(rawURL, "i.ytimg.com") {
		rawURL = strings.Replace(rawURL, "hqdefault.jpg", "maxresdefault.jpg", 1)
	}
	if strings.Contains(rawURL, "jiosaavn") || strings.Contains(rawURL, "saavn") {
		rawURL = strings.Replace(rawURL, "150x150", "500x500", 1)
		rawURL = strings.Replace(rawURL, "50x50", "500x500", 1)
	}
	if strings.Contains(rawURL, "gaana") {
		rawURL = strings.Replace(rawURL, "_175x175.jpg", "_640x640.jpg", 1)
		rawURL = strings.Replace(rawURL, "_50x50.jpg", "_640x640.jpg", 1)
	}
	return rawURL
}
