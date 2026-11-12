package spotify

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	clientTokenURL      = "https://clienttoken.spotify.com/v1/clienttoken"
	webPlayerClientID   = "d8a5ed958d274c2e8ee717e6a4b0971d"
	operationCanvas     = "canvas"
	hashCanvas1         = "575138ab27cd5c1b3e54da54d0a7cc8d85485402de26340c2145f0f6bb5e7a9f"
	canvasProxyPrimary  = "https://spotify-canva.vercel.app/api/canvas"
	canvasProxyFallback = "https://api.paxsenix.org/spotify/canvas"
)

var CanvasHashes = []string{hashCanvas1}

type Canvas struct {
	URL      string `json:"url"`
	TrackURI string `json:"track_uri,omitempty"`
}

type canvasMatch struct {
	ID       string
	Title    string
	Artist   string
	Duration int
}

func (c *Client) getClientToken() (string, error) {
	c.mu.Lock()
	now := time.Now().UnixMilli()
	if c.clientToken != "" && c.clientTokenExpMs > now+30_000 {
		token := c.clientToken
		c.mu.Unlock()
		return token, nil
	}
	c.mu.Unlock()

	deviceID, err := randomHex(16)
	if err != nil {
		return "", err
	}
	payload := map[string]any{
		"client_data": map[string]any{
			"client_version": AppVersion,
			"client_id":      webPlayerClientID,
			"js_sdk_data": map[string]any{
				"device_brand": "unknown",
				"device_model": "unknown",
				"os":           "windows",
				"os_version":   "10",
				"device_id":    deviceID,
				"device_type":  "computer",
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, clientTokenURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("spotify client-token returned %d", resp.StatusCode)
	}

	var parsed struct {
		GrantedToken *struct {
			Token                string `json:"token"`
			ExpiresAfterSeconds  int64  `json:"expires_after_seconds"`
		} `json:"granted_token"`
		Response *struct {
			GrantedToken *struct {
				Token               string `json:"token"`
				ExpiresAfterSeconds int64  `json:"expires_after_seconds"`
			} `json:"granted_token"`
		} `json:"response"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	granted := parsed.GrantedToken
	if granted == nil && parsed.Response != nil {
		granted = parsed.Response.GrantedToken
	}
	if granted == nil || strings.TrimSpace(granted.Token) == "" {
		return "", fmt.Errorf("spotify client-token missing")
	}
	expires := granted.ExpiresAfterSeconds
	if expires <= 0 {
		expires = 3600
	}
	expMs := now + (expires-60)*1000
	if expMs <= now {
		expMs = now + 30*60*1000
	}

	c.mu.Lock()
	c.clientToken = granted.Token
	c.clientTokenExpMs = expMs
	c.mu.Unlock()
	return granted.Token, nil
}

func (c *Client) GetCanvas(trackID string) (*Canvas, error) {
	id := strings.TrimPrefix(strings.TrimSpace(trackID), "spotify:track:")
	id = strings.TrimPrefix(id, "spotify:")
	if len(id) != 22 {
		return nil, fmt.Errorf("invalid spotify track id")
	}
	uri := "spotify:track:" + id

	if canvas, err := c.getCanvasPathfinder(uri); err == nil && canvas != nil && canvas.URL != "" {
		return canvas, nil
	}
	if canvas, err := c.getCanvasProxy(id); err == nil && canvas != nil && canvas.URL != "" {
		return canvas, nil
	}
	return nil, fmt.Errorf("canvas unavailable")
}

func (c *Client) getCanvasPathfinder(trackURI string) (*Canvas, error) {
	accessToken, err := c.getAccessToken()
	if err != nil {
		return nil, err
	}
	clientToken, err := c.getClientToken()
	if err != nil {
		return nil, err
	}

	var lastErr error
	for _, hash := range CanvasHashes {
		payload := map[string]any{
			"operationName": operationCanvas,
			"variables":     map[string]any{"trackUri": trackURI},
			"extensions": map[string]any{
				"persistedQuery": map[string]any{
					"version":    1,
					"sha256Hash": hash,
				},
			},
		}
		body, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		req, err := http.NewRequest(http.MethodPost, PathfinderBaseURL+"/v2/query", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Client-Token", clientToken)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Spotify-App-Version", AppVersion)
		req.Header.Set("Referer", "https://open.spotify.com/")
		req.Header.Set("Origin", "https://open.spotify.com")
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		raw, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			continue
		}
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			c.mu.Lock()
			c.tokenValue = ""
			c.tokenExpMs = 0
			c.clientToken = ""
			c.clientTokenExpMs = 0
			c.mu.Unlock()
			lastErr = fmt.Errorf("spotify canvas auth rejected")
			continue
		}
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("spotify canvas returned %d", resp.StatusCode)
			continue
		}
		var parsed map[string]any
		if err := json.Unmarshal(raw, &parsed); err != nil {
			lastErr = err
			continue
		}
		data, _ := parsed["data"].(map[string]any)
		union, _ := data["trackUnion"].(map[string]any)
		canvasObj, _ := union["canvas"].(map[string]any)
		url, _ := canvasObj["url"].(string)
		if strings.HasPrefix(url, "https://") {
			return &Canvas{URL: url, TrackURI: trackURI}, nil
		}
		lastErr = fmt.Errorf("canvas not found")
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("canvas not found")
}

func (c *Client) getCanvasProxy(trackID string) (*Canvas, error) {
	endpoints := []string{
		canvasProxyPrimary + "?trackId=" + trackID,
		canvasProxyFallback + "?id=" + trackID,
		canvasProxyFallback + "?trackId=" + trackID,
	}
	var lastErr error
	for _, endpoint := range endpoints {
		req, err := http.NewRequest(http.MethodGet, endpoint, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36")
		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		raw, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("canvas proxy returned %d", resp.StatusCode)
			continue
		}
		if url := extractCanvasURL(raw); url != "" {
			return &Canvas{URL: url, TrackURI: "spotify:track:" + trackID}, nil
		}
		lastErr = fmt.Errorf("canvas proxy empty")
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("canvas unavailable")
}

func extractCanvasURL(raw []byte) string {
	var asMap map[string]any
	if err := json.Unmarshal(raw, &asMap); err != nil {
		return ""
	}
	if url := findCanvasURL(asMap); url != "" {
		return url
	}
	return ""
}

func findCanvasURL(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		for _, key := range []string{"canvasUrl", "url", "mp4_url", "mp4Url"} {
			if url, ok := typed[key].(string); ok && strings.HasPrefix(url, "https://") && (strings.Contains(url, ".mp4") || strings.Contains(url, "canvaz") || strings.Contains(url, "cnvs")) {
				return url
			}
		}
		for _, child := range typed {
			if url := findCanvasURL(child); url != "" {
				return url
			}
		}
	case []any:
		for _, child := range typed {
			if url := findCanvasURL(child); url != "" {
				return url
			}
		}
	}
	return ""
}

func (c *Client) SearchTracks(query string) ([]canvasMatch, error) {
	cleanQuery := strings.TrimSpace(query)
	if cleanQuery == "" {
		return nil, nil
	}
	variables := map[string]any{
		"searchTerm":                    cleanQuery,
		"offset":                        0,
		"limit":                         10,
		"numberOfTopResults":            10,
		"includeAudiobooks":             false,
		"includeArtistHasConcertsField": false,
		"includePreReleases":            true,
		"includeLocalConcertsField":     false,
		"includeAuthors":                false,
	}
	data, err := c.queryWithFallback(OperationSearchDesktop, SearchDesktopHashes, variables, 2)
	if err != nil {
		return nil, err
	}
	searchV2, _ := data["searchV2"].(map[string]any)
	tracksSection, _ := searchV2["tracksV2"].(map[string]any)
	if tracksSection == nil {
		tracksSection, _ = searchV2["tracks"].(map[string]any)
	}
	if tracksSection == nil {
		return nil, nil
	}
	items, _ := tracksSection["items"].([]any)
	out := make([]canvasMatch, 0, len(items))
	for _, itemObj := range items {
		itemMap, ok := itemObj.(map[string]any)
		if !ok {
			continue
		}
		dataMap, _ := itemMap["item"].(map[string]any)
		if dataMap == nil {
			dataMap, _ = itemMap["data"].(map[string]any)
		}
		if dataMap == nil {
			dataMap = itemMap
		}
		inner, _ := dataMap["data"].(map[string]any)
		if inner != nil {
			dataMap = inner
		}
		track := parseTrack(dataMap)
		if track == nil {
			continue
		}
		out = append(out, canvasMatch{
			ID:       strings.TrimPrefix(track.ID, "spotify:"),
			Title:    track.Title,
			Artist:   track.Artist,
			Duration: track.DurationSeconds,
		})
	}
	return out, nil
}

func (c *Client) ResolveCanvas(title, artist string, durationSec int) (*Canvas, error) {
	title = strings.TrimSpace(title)
	artist = strings.TrimSpace(artist)
	if title == "" {
		return nil, fmt.Errorf("canvas requires a title")
	}
	query := strings.TrimSpace(title + " " + primaryArtist(artist))
	matches, err := c.SearchTracks(query)
	if err != nil {
		return nil, err
	}
	bestID := ""
	bestScore := -1
	wantTitle := normalizeMatchText(title)
	wantArtist := normalizeMatchText(primaryArtist(artist))
	for _, match := range matches {
		score := 0
		gotTitle := normalizeMatchText(match.Title)
		gotArtist := normalizeMatchText(match.Artist)
		if gotTitle == wantTitle {
			score += 8
		} else if strings.Contains(gotTitle, wantTitle) || strings.Contains(wantTitle, gotTitle) {
			score += 4
		}
		if wantArtist != "" {
			if gotArtist == wantArtist || strings.Contains(gotArtist, wantArtist) || strings.Contains(wantArtist, gotArtist) {
				score += 6
			}
		}
		if durationSec > 0 && match.Duration > 0 {
			delta := match.Duration - durationSec
			if delta < 0 {
				delta = -delta
			}
			if delta <= 2 {
				score += 5
			} else if delta <= 5 {
				score += 3
			} else if delta <= 12 {
				score += 1
			} else {
				score -= 2
			}
		}
		if score > bestScore {
			bestScore = score
			bestID = match.ID
		}
	}
	if bestID == "" || bestScore < 6 {
		return nil, fmt.Errorf("no canvas match")
	}
	return c.GetCanvas(bestID)
}

var matchNoise = regexp.MustCompile(`[^a-z0-9]+`)

func normalizeMatchText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "&", " and ")
	value = matchNoise.ReplaceAllString(value, " ")
	return strings.Join(strings.Fields(value), " ")
}

func primaryArtist(artist string) string {
	artist = strings.TrimSpace(artist)
	for _, sep := range []string{",", ";", " feat.", " ft.", " featuring ", " & ", " x ", " / "} {
		if index := strings.Index(strings.ToLower(artist), sep); index > 0 {
			return strings.TrimSpace(artist[:index])
		}
	}
	return artist
}

func randomHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
