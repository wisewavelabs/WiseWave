package jiosaavn

import (
	"crypto/des"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"wisewave-runtime/internal/innertube"
	"wisewave-runtime/internal/models"
)

type Client struct {
	httpClient *http.Client
}

func NewClient() *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

type saavnSearchResponse struct {
	Results []map[string]interface{} `json:"results"`
}

func (c *Client) Search(query string) ([]models.Track, error) {
	apiURL, err := url.Parse("https://www.jiosaavn.com/api.php")
	if err != nil {
		return nil, err
	}

	q := apiURL.Query()
	q.Set("__call", "search.getResults")
	q.Set("_format", "json")
	q.Set("_marker", "0")
	q.Set("q", query)
	q.Set("p", "1")
	q.Set("n", "30")
	apiURL.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", apiURL.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Referer", "https://www.jiosaavn.com/")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("saavn search returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var searchResp saavnSearchResponse
	if err := json.Unmarshal(body, &searchResp); err != nil {
		return nil, err
	}

	var tracks []models.Track
	for _, item := range searchResp.Results {
		id, ok := item["id"].(string)
		if !ok || id == "" {
			continue
		}

		title := extractString(item, "title", "song")
		if title == "" {
			continue
		}

		moreInfo, _ := item["more_info"].(map[string]interface{})
		artist := extractString(moreInfo, "primary_artists", "singers", "music")
		if artist == "" {
			artist = extractString(item, "primary_artists", "singers")
		}
		if artist == "" {
			artist = "Unknown Artist"
		}

		album := extractString(moreInfo, "album")
		if album == "" {
			album = extractString(item, "album")
		}

		durationSec := extractInt(moreInfo, "duration")
		if durationSec == 0 {
			durationSec = extractInt(item, "duration")
		}

		image := extractString(item, "image")
		image = strings.Replace(image, "150x150", "500x500", 1)
		image = strings.Replace(image, "50x50", "500x500", 1)
		image = strings.Replace(image, "http://", "https://", 1)

		durationText := formatDuration(durationSec)

		tracks = append(tracks, models.Track{
			ID:              "saavn:" + id,
			Title:           cleanText(title),
			Artist:          cleanText(artist),
			Album:           cleanText(album),
			Duration:        durationText,
			DurationSeconds: durationSec,
			AlbumArtURL:     image,
			StreamURL:       "/api/v1/stream/saavn:" + id,
			IsFavorite:      false,
		})
	}

	return tracks, nil
}

func (c *Client) ResolveAudioStream(saavnID string) (*innertube.ResolvedAudioStream, error) {
	cleanID := strings.TrimPrefix(saavnID, "saavn:")
	cleanID = strings.TrimPrefix(cleanID, "jiosaavn:")

	apiURL, err := url.Parse("https://www.jiosaavn.com/api.php")
	if err != nil {
		return nil, err
	}

	q := apiURL.Query()
	q.Set("__call", "song.getDetails")
	q.Set("_format", "json")
	q.Set("_marker", "0")
	q.Set("cc", "in")
	q.Set("pids", cleanID)
	apiURL.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", apiURL.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Referer", "https://www.jiosaavn.com/")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("saavn details returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var detailsMap map[string]interface{}
	if err := json.Unmarshal(body, &detailsMap); err != nil {
		return nil, err
	}

	rawTrack, ok := detailsMap[cleanID].(map[string]interface{})
	if !ok || rawTrack == nil {
		return nil, fmt.Errorf("track %s not found on saavn", cleanID)
	}

	moreInfo, _ := rawTrack["more_info"].(map[string]interface{})
	encryptedURL := extractString(moreInfo, "encrypted_media_url")
	if encryptedURL == "" {
		encryptedURL = extractString(rawTrack, "encrypted_media_url")
	}

	if encryptedURL == "" {
		return nil, fmt.Errorf("no encrypted stream url provided")
	}

	decryptedURL, err := decryptSaavnMediaUrl(encryptedURL)
	if err != nil {
		return nil, err
	}

	bitrate := 160000
	highQuality := extractString(moreInfo, "320kbps")
	if highQuality == "true" {
		bitrate = 320000
	}

	bitrateRegex := regexp.MustCompile(`_(?:12|48|96|160|320)\.mp4`)
	targetBitrateTag := fmt.Sprintf("_%d.mp4", bitrate/1000)
	finalURL := bitrateRegex.ReplaceAllString(decryptedURL, targetBitrateTag)
	finalURL = strings.Replace(finalURL, "http://", "https://", 1)

	parsedURL, err := url.Parse(finalURL)
	if err != nil || parsedURL.Scheme != "https" || !strings.HasSuffix(parsedURL.Hostname(), ".saavncdn.com") {
		return nil, fmt.Errorf("invalid saavn audio host")
	}

	return &innertube.ResolvedAudioStream{
		URL:         finalURL,
		Bitrate:     bitrate,
		MimeType:    "audio/mp4",
		Itag:        140,
		ExpiresAtMs: time.Now().Add(4 * time.Hour).UnixMilli(),
	}, nil
}

func decryptSaavnMediaUrl(encrypted string) (string, error) {
	ciphertext, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encrypted))
	if err != nil {
		return "", err
	}

	vector := assembleMatrix()
	block, err := des.NewTripleDESCipher(vector)
	if err != nil {
		return "", err
	}

	blockSize := block.BlockSize()
	if len(ciphertext)%blockSize != 0 || len(ciphertext) == 0 {
		return "", fmt.Errorf("invalid ciphertext block alignment")
	}

	plaintext := make([]byte, len(ciphertext))
	for i := 0; i < len(ciphertext); i += blockSize {
		block.Decrypt(plaintext[i:i+blockSize], ciphertext[i:i+blockSize])
	}

	padding := int(plaintext[len(plaintext)-1])
	if padding > 0 && padding <= blockSize {
		plaintext = plaintext[:len(plaintext)-padding]
	}

	return string(plaintext), nil
}

func assembleMatrix() []byte {
	seedMatrix := [...]byte{151, 112, 143, 240, 180, 125, 165, 253}
	assembled := make([]byte, 24)
	for i := 0; i < 8; i++ {
		stepA := byte(((i*37 + 0x4B) * 13) & 0xFF)
		stepC := byte(((i*59 + 0x8D) * 7) & 0xFF)
		val := byte(((int(stepA) ^ int(seedMatrix[i])) + int(stepC)) & 0xFF)
		assembled[i] = val
		assembled[i+8] = val
		assembled[i+16] = val
	}
	return assembled
}

func extractString(m map[string]interface{}, keys ...string) string {
	if m == nil {
		return ""
	}
	for _, key := range keys {
		if val, exists := m[key]; exists && val != nil {
			if s, ok := val.(string); ok && strings.TrimSpace(s) != "" {
				return s
			}
		}
	}
	return ""
}

func extractInt(m map[string]interface{}, keys ...string) int {
	if m == nil {
		return 0
	}
	for _, key := range keys {
		if val, exists := m[key]; exists && val != nil {
			switch v := val.(type) {
			case float64:
				return int(v)
			case int:
				return v
			case string:
				if parsed, err := strconv.Atoi(v); err == nil {
					return parsed
				}
			}
		}
	}
	return 0
}

func formatDuration(sec int) string {
	if sec <= 0 {
		return "0:00"
	}
	minutes := sec / 60
	seconds := sec % 60
	return fmt.Sprintf("%d:%02d", minutes, seconds)
}

func cleanText(s string) string {
	s = strings.ReplaceAll(s, "&quot;", "\"")
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&#039;", "'")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	return strings.TrimSpace(s)
}
