package innertube

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"wisewave-runtime/internal/models"
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
	endpoint := fmt.Sprintf("https://music.youtube.com/youtubei/v1/search?key=%s", PlayerClients[3].APIKey)

	hl := "en"
	gl := "US"
	if client.MusicClient != nil {
		if client.MusicClient.language != "" {
			hl = client.MusicClient.language
		}
		if client.MusicClient.country != "" {
			gl = client.MusicClient.country
		}
	}

	payload := map[string]interface{}{
		"context": map[string]interface{}{
			"client": map[string]interface{}{
				"clientName":    "WEB_REMIX",
				"clientVersion": "1.20260707.12.00",
				"hl":            hl,
				"gl":            gl,
			},
		},
		"query":  query,
		"params": "EgWKAQIIAWoKEAkQBRAKEAMQBA==",
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", PlayerClients[3].UserAgent)
	req.Header.Set("Origin", "https://music.youtube.com")
	req.Header.Set("Referer", "https://music.youtube.com/")

	resp, err := client.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return parseSearchResponse(respBytes)
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
			for _, child := range node {
				walk(child)
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
