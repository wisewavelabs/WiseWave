package spotify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"wisewave-runtime/internal/models"
)

const (
	TokenEndpointPrimary   = "https://spotokn-chi.vercel.app/api/getToken"
	TokenEndpointSecondary = "https://spotokn-dfo3.vercel.app/api/getToken"

	PathfinderBaseURL = "https://api-partner.spotify.com/pathfinder"
	AppVersion        = "1.2.80.289.gd6b01cc3"

	OperationSearchDesktop = "searchDesktop"
	HashSearchDesktop1     = "4801118d4a100f756e833d33984436a3899cff359c532f8fd3aaf174b60b3b49"
	HashSearchDesktop2     = "db61238974d27839a136c9dc02bfdbe3fab7635f21cf85976ebff9a1ee281345"
	HashSearchDesktop3     = "75bbf6bfcfdf85b8fc828417bfad92b7cd66bf7f556d85670f4da8292373ebec"
	HashSearchDesktop4     = "fcad5a3e0d5af727fb76966f06971c19cfa2275e6ff7671196753e008611873c"

	OperationFetchPlaylist = "fetchPlaylist"
	HashFetchPlaylist1     = "bb67e0af06e8d6f52b531f97468ee4acd44cd0f82b988e15c2ea47b1148efc77"
	HashFetchPlaylist2     = "e4b2953f160e58e38ac025d79b5a9b3aceee5c4c716598e9830bfceb69faff5f"

	OperationGetTrack = "getTrack"
	HashGetTrack1     = "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294"
	HashGetTrack2     = "e101aead6d78faa11d75bec5e36385a07b2f1c4a0420932d374d89ee17c70dd6"
	HashGetTrack3     = "e101aeddc7d51f25103a8905a8f5c360810db5678456a1e8a9391ab1a12e2e92"
	HashGetTrack      = HashGetTrack1

	OperationGetAlbum = "getAlbum"
	HashGetAlbum1     = "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10"
	HashGetAlbum2     = "46ae954ef2d2fe7732b4b2b4022157b2e18b7abf4fb6201a5e17665a723b0301"
	HashGetAlbum      = HashGetAlbum1

	OperationQueryArtistOverview = "queryArtistOverview"
	HashQueryArtistOverview1     = "ae0e2958a4ab645b35ca19ac04d0495ae12d9c5d7b7286217674801a9aab281a"
	HashQueryArtistOverview2     = "35648a11a370218be63b07d05e045cb92f929a56550bcc219f6079abfb278a82"
	HashQueryArtistOverview      = HashQueryArtistOverview1

	OperationInternalLinkRecommenderTrack = "internalLinkRecommenderTrack"
	HashInternalLinkRecommenderTrack1     = "c77098ee9d6ee8ad3eb844938722db60570d040b49f41f5ec6e7be9160a7c86b"
	HashInternalLinkRecommenderTrack      = HashInternalLinkRecommenderTrack1
)

var (
	SearchDesktopHashes = []string{
		HashSearchDesktop1,
		HashSearchDesktop2,
		HashSearchDesktop3,
		HashSearchDesktop4,
	}
	FetchPlaylistHashes = []string{
		HashFetchPlaylist1,
		HashFetchPlaylist2,
	}
	GetTrackHashes = []string{
		HashGetTrack1,
		HashGetTrack2,
		HashGetTrack3,
	}
	GetAlbumHashes = []string{
		HashGetAlbum1,
		HashGetAlbum2,
	}
	QueryArtistOverviewHashes = []string{
		HashQueryArtistOverview1,
		HashQueryArtistOverview2,
	}
	InternalLinkRecommenderTrackHashes = []string{
		HashInternalLinkRecommenderTrack1,
	}
)

type Client struct {
	httpClient *http.Client
	mu         sync.Mutex
	tokenValue string
	tokenExpMs int64
}

func NewClient() *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

type tokenResponse struct {
	AccessToken string `json:"accessToken"`
	ExpiresMs   int64  `json:"accessTokenExpirationTimestampMs"`
}

func (c *Client) getAccessToken() (string, error) {
	c.mu.Lock()
	now := time.Now().UnixMilli()
	if c.tokenValue != "" && c.tokenExpMs > now+30000 {
		token := c.tokenValue
		c.mu.Unlock()
		return token, nil
	}
	c.mu.Unlock()

	var tokenEndpoints []string
	if envURL := strings.TrimSpace(os.Getenv("SPOTIFY_TOKEN_URL")); envURL != "" {
		tokenEndpoints = append(tokenEndpoints, envURL)
	}
	tokenEndpoints = append(tokenEndpoints,
		TokenEndpointPrimary,
		TokenEndpointSecondary,
	)

	var lastErr error
	for _, tokenURL := range tokenEndpoints {
		req, err := http.NewRequest("GET", tokenURL, nil)
		if err != nil {
			lastErr = err
			continue
		}

		if auth := strings.TrimSpace(os.Getenv("SPOTIFY_TOKEN_AUTHORIZATION")); auth != "" {
			req.Header.Set("Authorization", auth)
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6998.178 Safari/537.36")
		req.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			lastErr = fmt.Errorf("spotify token service returned %d", resp.StatusCode)
			continue
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}

		var tr tokenResponse
		if err := json.Unmarshal(body, &tr); err != nil {
			lastErr = err
			continue
		}

		if tr.AccessToken == "" {
			lastErr = fmt.Errorf("invalid access token returned")
			continue
		}

		maxExp := now + (3600 * 1000)
		if tr.ExpiresMs <= 0 || tr.ExpiresMs > maxExp {
			tr.ExpiresMs = maxExp
		}

		c.mu.Lock()
		c.tokenValue = tr.AccessToken
		c.tokenExpMs = tr.ExpiresMs
		c.mu.Unlock()

		return tr.AccessToken, nil
	}

	if lastErr != nil {
		return "", lastErr
	}
	return "", fmt.Errorf("no spotify token providers available")
}

func (c *Client) query(operationName, sha256Hash string, variables map[string]interface{}, version int) (map[string]interface{}, error) {
	apiURL := fmt.Sprintf("%s/v%d/query", PathfinderBaseURL, version)

	for attempt := 0; attempt < 2; attempt++ {
		token, err := c.getAccessToken()
		if err != nil {
			return nil, err
		}

		payload := map[string]interface{}{
			"operationName": operationName,
			"variables":     variables,
			"extensions": map[string]interface{}{
				"persistedQuery": map[string]interface{}{
					"version":    1,
					"sha256Hash": sha256Hash,
				},
			},
		}

		payloadBytes, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}

		req, err := http.NewRequest("POST", apiURL, bytes.NewReader(payloadBytes))
		if err != nil {
			return nil, err
		}

		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Spotify-App-Version", AppVersion)
		req.Header.Set("Referer", "https://open.spotify.com/")
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6998.178 Spotify/1.2.65.255 Safari/537.36")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, err
		}

		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			resp.Body.Close()
			c.mu.Lock()
			c.tokenValue = ""
			c.tokenExpMs = 0
			c.mu.Unlock()
			continue
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			if resp.StatusCode == http.StatusTooManyRequests {
				return nil, fmt.Errorf("spotify search is busy, please try again later")
			}
			return nil, fmt.Errorf("spotify query returned status %d", resp.StatusCode)
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}

		var rawResp map[string]interface{}
		if err := json.Unmarshal(body, &rawResp); err != nil {
			return nil, err
		}

		if errs, ok := rawResp["errors"].([]interface{}); ok && len(errs) > 0 {
			return nil, fmt.Errorf("spotify service error")
		}

		data, ok := rawResp["data"].(map[string]interface{})
		if !ok || data == nil {
			return nil, fmt.Errorf("spotify response missing data payload")
		}

		return data, nil
	}

	return nil, fmt.Errorf("spotify authentication was rejected")
}

func (c *Client) queryWithFallback(operationName string, hashes []string, variables map[string]interface{}, preferredVersion int) (map[string]interface{}, error) {
	var lastErr error
	versions := []int{preferredVersion}
	switch preferredVersion {
	case 2:
		versions = append(versions, 1)
	case 1:
		versions = append(versions, 2)
	}

	for _, hash := range hashes {
		if strings.TrimSpace(hash) == "" {
			continue
		}
		for _, v := range versions {
			data, err := c.query(operationName, hash, variables, v)
			if err == nil && data != nil {
				return data, nil
			}
			lastErr = err
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("spotify operation %s failed across all query hashes", operationName)
}

func (c *Client) SearchPlaylists(query string, offset int) ([]models.Playlist, string, error) {
	cleanQuery := strings.TrimSpace(query)
	if cleanQuery == "" {
		return []models.Playlist{}, "", nil
	}

	if offset < 0 {
		offset = 0
	}

	variables := map[string]interface{}{
		"searchTerm":                    cleanQuery,
		"offset":                        offset,
		"limit":                         25,
		"numberOfTopResults":            20,
		"includeAudiobooks":             false,
		"includeArtistHasConcertsField": false,
		"includePreReleases":            true,
		"includeLocalConcertsField":     false,
		"includeAuthors":                false,
	}

	data, err := c.queryWithFallback(OperationSearchDesktop, SearchDesktopHashes, variables, 2)
	if err != nil {
		return nil, "", err
	}

	searchV2, _ := data["searchV2"].(map[string]interface{})
	playlistsSection, _ := searchV2["playlists"].(map[string]interface{})
	if playlistsSection == nil {
		return []models.Playlist{}, "", nil
	}

	var playlists []models.Playlist
	items, _ := playlistsSection["items"].([]interface{})
	for _, itemObj := range items {
		itemMap, ok := itemObj.(map[string]interface{})
		if !ok {
			continue
		}
		dataMap, ok := itemMap["data"].(map[string]interface{})
		if !ok {
			continue
		}
		uri, _ := dataMap["uri"].(string)
		if !strings.HasPrefix(uri, "spotify:playlist:") {
			continue
		}
		playlists = append(playlists, parsePlaylist(dataMap, ""))
	}

	var continuation string
	totalCount := extractInt(playlistsSection, "totalCount")
	if totalCount > 0 && offset+25 < totalCount && offset < 1000 {
		continuation = fmt.Sprintf("sp-search:%d", offset+25)
	}

	return playlists, continuation, nil
}

func (c *Client) GetPlaylist(input string, offset int) (*models.PlaylistDetail, error) {
	identifier, err := ExtractPlaylistID(input)
	if err != nil {
		return nil, err
	}

	if offset < 0 {
		offset = 0
	}

	variables := map[string]interface{}{
		"uri":                       "spotify:playlist:" + identifier,
		"offset":                    offset,
		"limit":                     100,
		"enableWatchFeedEntrypoint": false,
	}

	data, err := c.queryWithFallback(OperationFetchPlaylist, FetchPlaylistHashes, variables, 1)
	if err != nil {
		return nil, err
	}

	playlistV2, _ := data["playlistV2"].(map[string]interface{})
	if playlistV2 == nil {
		return nil, fmt.Errorf("playlist not found or is private")
	}

	name, _ := playlistV2["name"].(string)
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("playlist not found or is private")
	}

	meta := parsePlaylist(playlistV2, identifier)

	contentMap, _ := playlistV2["content"].(map[string]interface{})
	var tracks []models.Track
	if contentMap != nil {
		total := extractInt(contentMap, "totalCount")
		meta.TrackCount = total
		rawItems, _ := contentMap["items"].([]interface{})
		for _, itemObj := range rawItems {
			itemMap, ok := itemObj.(map[string]interface{})
			if !ok {
				continue
			}
			itemV2, ok := itemMap["itemV2"].(map[string]interface{})
			if !ok {
				continue
			}
			trackData, ok := itemV2["data"].(map[string]interface{})
			if !ok {
				continue
			}
			if t := parseTrack(trackData); t != nil {
				tracks = append(tracks, *t)
			}
		}

		if total > 0 && offset+100 < total && offset < 10000 {
			meta.Continuation = fmt.Sprintf("sp-playlist:%s:%d", identifier, offset+100)
		}
	}

	return &models.PlaylistDetail{
		Playlist:     meta,
		Tracks:       tracks,
		Continuation: meta.Continuation,
	}, nil
}

func (c *Client) GetTrack(input string) (*models.Track, error) {
	identifier := strings.TrimPrefix(input, "spotify:track:")
	identifier = strings.TrimPrefix(identifier, "spotify:")
	if len(identifier) != 22 {
		return nil, fmt.Errorf("invalid spotify track id")
	}

	variables := map[string]interface{}{
		"uri": "spotify:track:" + identifier,
	}

	data, err := c.queryWithFallback(OperationGetTrack, GetTrackHashes, variables, 1)
	if err != nil {
		return nil, err
	}

	trackUnion, _ := data["trackUnion"].(map[string]interface{})
	if trackUnion == nil {
		return nil, fmt.Errorf("track not found")
	}

	t := parseTrack(trackUnion)
	if t == nil {
		return nil, fmt.Errorf("track unavailable")
	}

	return t, nil
}

func (c *Client) GetAlbum(input string) ([]models.Track, string, error) {
	identifier := strings.TrimPrefix(input, "spotify:album:")
	identifier = strings.TrimPrefix(identifier, "spotify:")
	if len(identifier) != 22 {
		return nil, "", fmt.Errorf("invalid spotify album id")
	}

	variables := map[string]interface{}{
		"uri":    "spotify:album:" + identifier,
		"locale": "",
	}

	data, err := c.queryWithFallback(OperationGetAlbum, GetAlbumHashes, variables, 1)
	if err != nil {
		return nil, "", err
	}

	albumUnion, _ := data["albumUnion"].(map[string]interface{})
	if albumUnion == nil {
		return nil, "", fmt.Errorf("album not found")
	}

	albumName, _ := albumUnion["name"].(string)
	tracksObj, _ := albumUnion["tracks"].(map[string]interface{})
	if tracksObj == nil {
		return []models.Track{}, albumName, nil
	}

	var tracks []models.Track
	items, _ := tracksObj["items"].([]interface{})
	for _, itemObj := range items {
		itemMap, ok := itemObj.(map[string]interface{})
		if !ok {
			continue
		}
		trackData, ok := itemMap["track"].(map[string]interface{})
		if !ok {
			trackData = itemMap
		}
		if t := parseTrack(trackData); t != nil {
			if t.Album == "" {
				t.Album = cleanText(albumName)
			}
			tracks = append(tracks, *t)
		}
	}

	return tracks, cleanText(albumName), nil
}

func (c *Client) QueryArtistOverview(input string) (map[string]interface{}, error) {
	identifier := strings.TrimPrefix(input, "spotify:artist:")
	identifier = strings.TrimPrefix(identifier, "spotify:")
	if len(identifier) != 22 {
		return nil, fmt.Errorf("invalid spotify artist id")
	}

	variables := map[string]interface{}{
		"uri":    "spotify:artist:" + identifier,
		"locale": "",
	}

	data, err := c.queryWithFallback(OperationQueryArtistOverview, QueryArtistOverviewHashes, variables, 1)
	if err != nil {
		return nil, err
	}

	artistUnion, _ := data["artistUnion"].(map[string]interface{})
	if artistUnion == nil {
		return nil, fmt.Errorf("artist overview not found")
	}

	return artistUnion, nil
}

func (c *Client) InternalLinkRecommenderTrack(input string) ([]models.Track, error) {
	identifier := strings.TrimPrefix(input, "spotify:track:")
	identifier = strings.TrimPrefix(identifier, "spotify:")
	if len(identifier) != 22 {
		return nil, fmt.Errorf("invalid spotify track id")
	}

	variables := map[string]interface{}{
		"uri": "spotify:track:" + identifier,
	}

	data, err := c.queryWithFallback(OperationInternalLinkRecommenderTrack, InternalLinkRecommenderTrackHashes, variables, 1)
	if err != nil {
		return nil, err
	}

	recObj, _ := data["internalLinkRecommenderTrack"].(map[string]interface{})
	if recObj == nil {
		return []models.Track{}, nil
	}

	var tracks []models.Track
	items, _ := recObj["items"].([]interface{})
	for _, itemObj := range items {
		itemMap, ok := itemObj.(map[string]interface{})
		if !ok {
			continue
		}
		trackData, ok := itemMap["data"].(map[string]interface{})
		if !ok {
			trackData = itemMap
		}
		if t := parseTrack(trackData); t != nil {
			tracks = append(tracks, *t)
		}
	}

	return tracks, nil
}

func ExtractPlaylistID(input string) (string, error) {
	trimmed := strings.TrimSpace(input)
	if re := regexp.MustCompile(`^spotify:playlist:([A-Za-z0-9]{22})$`); re.MatchString(trimmed) {
		matches := re.FindStringSubmatch(trimmed)
		return matches[1], nil
	}

	if strings.Contains(trimmed, "open.spotify.com") {
		if parsed, err := url.Parse(trimmed); err == nil {
			path := parsed.Path
			re := regexp.MustCompile(`^/(?:intl-[a-z]+/)?playlist/([A-Za-z0-9]{22})/?$`)
			if matches := re.FindStringSubmatch(path); len(matches) > 1 {
				return matches[1], nil
			}
		}
	}

	clean := strings.TrimPrefix(trimmed, "spotify:playlist:")
	clean = strings.TrimPrefix(clean, "spotify:")
	if regexp.MustCompile(`^[A-Za-z0-9]{22}$`).MatchString(clean) {
		return clean, nil
	}

	return "", fmt.Errorf("invalid spotify playlist identifier")
}

func parsePlaylist(m map[string]interface{}, defaultID string) models.Playlist {
	rawURI, _ := m["uri"].(string)
	idStr := strings.TrimPrefix(rawURI, "spotify:playlist:")
	if idStr == "" {
		idStr, _ = m["id"].(string)
	}
	if idStr == "" {
		idStr = defaultID
	}

	title, _ := m["name"].(string)
	description, _ := m["description"].(string)
	stripTags := regexp.MustCompile(`<[^>]*>`)
	description = stripTags.ReplaceAllString(description, "")

	var author string
	if ownerV2, ok := m["ownerV2"].(map[string]interface{}); ok {
		if data, ok := ownerV2["data"].(map[string]interface{}); ok {
			author, _ = data["name"].(string)
		}
	}

	artworkURL := extractArtwork(m)

	return models.Playlist{
		ID:          "spotify:" + idStr,
		Title:       cleanText(title),
		Author:      cleanText(author),
		ArtworkURL:  artworkURL,
		Description: cleanText(description),
	}
}

func parseTrack(m map[string]interface{}) *models.Track {
	uri, _ := m["uri"].(string)
	if !strings.HasPrefix(uri, "spotify:track:") {
		return nil
	}

	trackID := strings.TrimPrefix(uri, "spotify:track:")
	if len(trackID) != 22 {
		return nil
	}

	if isPlayable, ok := m["isPlayable"].(bool); ok && !isPlayable {
		return nil
	}
	if playability, ok := m["playability"].(map[string]interface{}); ok {
		if playable, ok := playability["playable"].(bool); ok && !playable {
			return nil
		}
	}

	title, _ := m["name"].(string)
	if strings.TrimSpace(title) == "" {
		return nil
	}

	var artists []string
	for _, key := range []string{"artists", "firstArtist", "otherArtists"} {
		artistsMap, ok := m[key].(map[string]interface{})
		if !ok {
			continue
		}
		if items, ok := artistsMap["items"].([]interface{}); ok {
			for _, itemObj := range items {
				item, ok := itemObj.(map[string]interface{})
				if !ok {
					continue
				}
				if profile, ok := item["profile"].(map[string]interface{}); ok {
					if name, ok := profile["name"].(string); ok && strings.TrimSpace(name) != "" {
						artists = append(artists, strings.TrimSpace(name))
						continue
					}
				}
				if name, ok := item["name"].(string); ok && strings.TrimSpace(name) != "" {
					artists = append(artists, strings.TrimSpace(name))
				}
			}
		}
	}

	artistName := strings.Join(artists, ", ")
	if artistName == "" {
		artistName = "Unknown Artist"
	}

	var albumName string
	var artworkURL string
	if albumMap, ok := m["albumOfTrack"].(map[string]interface{}); ok {
		albumName, _ = albumMap["name"].(string)
		if coverArt, ok := albumMap["coverArt"].(map[string]interface{}); ok {
			artworkURL = extractArtwork(coverArt)
		}
	}

	var durationSec int
	if durMap, ok := m["duration"].(map[string]interface{}); ok {
		if ms := extractInt(durMap, "totalMilliseconds"); ms > 0 {
			durationSec = ms / 1000
		}
	}
	if durationSec == 0 {
		if durMap, ok := m["trackDuration"].(map[string]interface{}); ok {
			if ms := extractInt(durMap, "totalMilliseconds"); ms > 0 {
				durationSec = ms / 1000
			}
		}
	}

	streamURL := fmt.Sprintf("/api/v1/stream/%s?title=%s", "spotify:"+trackID, url.QueryEscape(title+" "+artistName))

	return &models.Track{
		ID:              "spotify:" + trackID,
		Title:           cleanText(title),
		Artist:          cleanText(artistName),
		Album:           cleanText(albumName),
		Duration:        formatDuration(durationSec),
		DurationSeconds: durationSec,
		AlbumArtURL:     artworkURL,
		StreamURL:       streamURL,
		IsFavorite:      false,
	}
}

func extractArtwork(m map[string]interface{}) string {
	if m == nil {
		return ""
	}

	if sources, ok := m["sources"].([]interface{}); ok && len(sources) > 0 {
		for i := len(sources) - 1; i >= 0; i-- {
			if srcMap, ok := sources[i].(map[string]interface{}); ok {
				if u, ok := srcMap["url"].(string); ok && strings.HasPrefix(u, "https://") {
					return u
				}
			}
		}
	}

	if images, ok := m["images"].(map[string]interface{}); ok {
		if items, ok := images["items"].([]interface{}); ok && len(items) > 0 {
			if firstItem, ok := items[0].(map[string]interface{}); ok {
				if sources, ok := firstItem["sources"].([]interface{}); ok && len(sources) > 0 {
					for i := len(sources) - 1; i >= 0; i-- {
						if srcMap, ok := sources[i].(map[string]interface{}); ok {
							if u, ok := srcMap["url"].(string); ok && strings.HasPrefix(u, "https://") {
								return u
							}
						}
					}
				}
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
			case int64:
				return int(v)
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
