package gaana

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
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

func (c *Client) Search(query string) ([]models.Track, error) {
	params := url.Values{}
	params.Set("type", "search")
	params.Set("country", "IN")
	params.Set("page", "0")
	params.Set("keyword", query)
	params.Set("secType", "track")

	apiURL := fmt.Sprintf("https://gaana.com/apiv2?%s", params.Encode())
	req, err := http.NewRequest("POST", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Origin", "https://gaana.com")
	req.Header.Set("Referer", "https://gaana.com/")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gaana search returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var rawResp map[string]interface{}
	if err := json.Unmarshal(body, &rawResp); err != nil {
		return nil, err
	}

	groups, ok := rawResp["gr"].([]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid gaana search response structure")
	}

	var tracks []models.Track
	for _, groupObj := range groups {
		group, ok := groupObj.(map[string]interface{})
		if !ok || group["ty"] != "Track" {
			continue
		}

		rows, ok := group["gd"].([]interface{})
		if !ok {
			continue
		}

		for _, rowObj := range rows {
			row, ok := rowObj.(map[string]interface{})
			if !ok {
				continue
			}

			seo := extractString(row, "seo")
			title := extractString(row, "track_title", "name")
			if seo == "" || title == "" {
				continue
			}

			artist := extractArtists(row["artist"])
			album := extractString(row, "album_title", "album")
			durationSec := extractInt(row, "duration")
			artwork := extractString(row, "artwork_large", "atw")
			artwork = strings.Replace(artwork, "http://", "https://", 1)

			tracks = append(tracks, models.Track{
				ID:              "gaana:" + seo,
				Title:           cleanText(title),
				Artist:          cleanText(artist),
				Album:           cleanText(album),
				Duration:        formatDuration(durationSec),
				DurationSeconds: durationSec,
				AlbumArtURL:     artwork,
				StreamURL:       "/api/v1/stream/gaana:" + seo,
				IsFavorite:      false,
			})
		}
	}

	return tracks, nil
}

func (c *Client) ResolveAudioStream(slug string) (*innertube.ResolvedAudioStream, error) {
	cleanSlug := strings.TrimPrefix(slug, "gaana:")

	trackID, err := c.getTrackIDBySlug(cleanSlug)
	if err != nil {
		return nil, err
	}

	form := url.Values{}
	form.Set("quality", "high")
	form.Set("track_id", trackID)
	form.Set("stream_format", "mp4")

	req, err := http.NewRequest("POST", "https://gaana.com/api/stream-url", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Origin", "https://gaana.com")
	req.Header.Set("Referer", "https://gaana.com/")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gaana stream-url returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var streamResp map[string]interface{}
	if err := json.Unmarshal(body, &streamResp); err != nil {
		return nil, err
	}

	dataObj, ok := streamResp["data"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("gaana stream data missing")
	}

	streamPath, ok := dataObj["stream_path"].(string)
	if !ok || streamPath == "" {
		return nil, fmt.Errorf("no gaana stream path available")
	}

	hlsURL, err := decryptGaanaStreamPath(streamPath)
	if err != nil {
		return nil, err
	}

	return &innertube.ResolvedAudioStream{
		URL:         hlsURL,
		Bitrate:     320000,
		MimeType:    "application/vnd.apple.mpegurl",
		Itag:        999,
		ExpiresAtMs: time.Now().Add(1 * time.Hour).UnixMilli(),
	}, nil
}

func (c *Client) getTrackIDBySlug(slug string) (string, error) {
	params := url.Values{}
	params.Set("type", "songDetail")
	params.Set("country", "IN")
	params.Set("page", "0")
	params.Set("seokey", slug)

	apiURL := fmt.Sprintf("https://gaana.com/apiv2?%s", params.Encode())
	req, err := http.NewRequest("POST", apiURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Origin", "https://gaana.com")
	req.Header.Set("Referer", "https://gaana.com/")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("gaana songDetail returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var detailResp map[string]interface{}
	if err := json.Unmarshal(body, &detailResp); err != nil {
		return "", err
	}

	tracksList, ok := detailResp["tracks"].([]interface{})
	if !ok || len(tracksList) == 0 {
		return "", fmt.Errorf("song detail not found for %s", slug)
	}

	item, ok := tracksList[0].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("invalid track detail format")
	}

	trackID := extractString(item, "track_id", "entity_id")
	if trackID == "" {
		return "", fmt.Errorf("missing track id")
	}

	return trackID, nil
}

func decryptGaanaStreamPath(streamPath string) (string, error) {
	if len(streamPath) < 17 {
		return "", fmt.Errorf("invalid stream path length")
	}

	offset := int(streamPath[0] - '0')
	if offset < 0 || offset > 9 || offset+16 >= len(streamPath) {
		return "", fmt.Errorf("invalid stream path header offset")
	}

	encoded := streamPath[offset+16:]
	ciphertext, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		ciphertext, err = base64.URLEncoding.DecodeString(encoded)
		if err != nil {
			return "", err
		}
	}

	if len(ciphertext) < 16 {
		return "", fmt.Errorf("insufficient ciphertext payload")
	}

	validLen := len(ciphertext) - (len(ciphertext) % 16)
	ciphertext = ciphertext[:validLen]

	blockVector, initVector := synthesizeGaanaVectors()
	block, err := aes.NewCipher(blockVector)
	if err != nil {
		return "", err
	}

	mode := cipher.NewCBCDecrypter(block, initVector)
	plaintext := make([]byte, len(ciphertext))
	mode.CryptBlocks(plaintext, ciphertext)

	var sb strings.Builder
	for _, b := range plaintext {
		if b >= 0x20 && b <= 0x7E {
			sb.WriteByte(b)
		}
	}
	clean := sb.String()

	hlsIndex := strings.Index(clean, "hls/")
	if hlsIndex < 0 {
		return "", fmt.Errorf("hls segment path missing from decoded payload")
	}

	targetHost := "https://vodhlsgaana-ebw.akamaized.net"
	return fmt.Sprintf("%s/%s", targetHost, clean[hlsIndex:]), nil
}

func synthesizeGaanaVectors() ([]byte, []byte) {
	seriesAlpha := [...]byte{67, 177, 141, 176, 135, 66, 162, 178, 126, 112, 252, 240, 27, 156, 225, 169}
	seriesBeta := [...]byte{82, 123, 142, 192, 77, 94, 212, 237, 121, 105, 174, 210, 116, 166, 30, 180}
	firstBuffer := make([]byte, 16)
	secondBuffer := make([]byte, 16)

	for i := 0; i < 16; i++ {
		stepA := byte(((i*37 + 0x4B) * 13) & 0xFF)
		stepC := byte(((i*59 + 0x8D) * 7) & 0xFF)
		firstBuffer[i] = byte(((int(stepA) ^ int(seriesAlpha[i])) + int(stepC)) & 0xFF)
		secondBuffer[i] = byte(((int(stepA) ^ int(seriesBeta[i])) + int(stepC)) & 0xFF)
	}

	return firstBuffer, secondBuffer
}

func extractArtists(val interface{}) string {
	if val == nil {
		return "Unknown Artist"
	}
	if arr, ok := val.([]interface{}); ok {
		var names []string
		for _, item := range arr {
			if m, ok := item.(map[string]interface{}); ok {
				if name, ok := m["name"].(string); ok && strings.TrimSpace(name) != "" {
					names = append(names, cleanText(name))
				}
			}
		}
		if len(names) > 0 {
			return strings.Join(names, ", ")
		}
	}
	return "Unknown Artist"
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
