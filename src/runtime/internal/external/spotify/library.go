package spotify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	pathfinderQueryURL = "https://api-partner.spotify.com/pathfinder/v2/query"
	playlistPage       = 50
	maxPlaylistPages   = 40
	maxGQLRetries      = 3
	maxCountWorkers    = 4
)

var (
	hashProfileAttributes  = "53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced"
	hashLibraryV3          = "973e511ca44261fda7eebac8b653155e7caee3675abb4fb110cc1b8c78b091c3"
	hashFetchLibraryTracks = "087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240"
	hashFetchPlaylist      = []string{
		"346811f856fb0b7e4f6c59f8ebea78dd081c6e2fb01b77c954b26259d5fc6763",
		HashFetchPlaylist1,
		HashFetchPlaylist2,
	}
)

type LibraryProfile struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	ImageURL    string `json:"image_url"`
	Product     string `json:"product"`
	Country     string `json:"country"`
}

type LibraryPlaylist struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Owner      string `json:"owner"`
	ImageURL   string `json:"image_url"`
	TrackCount int    `json:"track_count"`
}

type LibrarySnapshot struct {
	Profile       LibraryProfile    `json:"profile"`
	LikedSongs    int               `json:"liked_songs"`
	Playlists     []LibraryPlaylist `json:"playlists"`
	PlaylistCount int               `json:"playlist_count"`
}

type LibraryProgress struct {
	Phase            string `json:"phase"`
	PlaylistsLoaded  int    `json:"playlists_loaded"`
	PlaylistTotalEst int    `json:"playlist_total_est"`
	LikedSongs       int    `json:"liked_songs"`
	DisplayName      string `json:"display_name"`
	ImageURL         string `json:"image_url"`
}

func FetchLibrary(spDc, spKey string, onProgress func(LibraryProgress)) (LibrarySnapshot, error) {
	token, err := FetchTokenFromCookie(spDc, spKey)
	if err != nil {
		return LibrarySnapshot{}, err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	access := strings.TrimSpace(token.AccessToken)

	if onProgress != nil {
		onProgress(LibraryProgress{Phase: "profile"})
	}
	profile, err := fetchProfileGQL(client, access)
	if err != nil {
		profile, err = fetchProfileREST(client, access)
		if err != nil {
			return LibrarySnapshot{}, err
		}
	}
	if onProgress != nil {
		onProgress(LibraryProgress{
			Phase:       "liked",
			DisplayName: profile.DisplayName,
			ImageURL:    profile.ImageURL,
		})
	}

	liked, err := fetchLikedTotalGQL(client, access)
	if err != nil {
		return LibrarySnapshot{}, err
	}
	if onProgress != nil {
		onProgress(LibraryProgress{
			Phase:       "playlists",
			LikedSongs:  liked,
			DisplayName: profile.DisplayName,
			ImageURL:    profile.ImageURL,
		})
	}

	playlists, err := fetchAllPlaylistsGQL(client, access, func(loaded, total int) {
		if onProgress != nil {
			onProgress(LibraryProgress{
				Phase:            "playlists",
				PlaylistsLoaded:  loaded,
				PlaylistTotalEst: total,
				LikedSongs:       liked,
				DisplayName:      profile.DisplayName,
				ImageURL:         profile.ImageURL,
			})
		}
	})
	if err != nil {
		return LibrarySnapshot{}, err
	}
	playlists = enrichPlaylistTrackCounts(client, access, playlists, func(loaded int) {
		if onProgress != nil {
			onProgress(LibraryProgress{
				Phase:            "playlists",
				PlaylistsLoaded:  loaded,
				PlaylistTotalEst: len(playlists),
				LikedSongs:       liked,
				DisplayName:      profile.DisplayName,
				ImageURL:         profile.ImageURL,
			})
		}
	})
	return LibrarySnapshot{
		Profile:       profile,
		LikedSongs:    liked,
		Playlists:     playlists,
		PlaylistCount: len(playlists),
	}, nil
}

func fetchProfileGQL(client *http.Client, accessToken string) (LibraryProfile, error) {
	raw, err := graphqlPost(client, accessToken, "profileAttributes", hashProfileAttributes, map[string]any{})
	if err != nil {
		return LibraryProfile{}, err
	}
	profile := asMap(asMap(asMap(raw["data"])["me"])["profile"])
	if len(profile) == 0 {
		return LibraryProfile{}, fmt.Errorf("Spotify profile was empty")
	}
	uri := asString(profile["uri"])
	id := uri
	if i := strings.LastIndex(uri, ":"); i >= 0 {
		id = uri[i+1:]
	}
	image := firstImageURL(asMap(profile["avatar"])["sources"])
	return LibraryProfile{
		ID:          strings.TrimSpace(id),
		DisplayName: strings.TrimSpace(asString(profile["name"])),
		ImageURL:    image,
	}, nil
}

func fetchProfileREST(client *http.Client, accessToken string) (LibraryProfile, error) {
	raw, err := restGet(client, accessToken, "https://api.spotify.com/v1/me")
	if err != nil {
		return LibraryProfile{}, err
	}
	var payload struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name"`
		Email       string `json:"email"`
		Product     string `json:"product"`
		Country     string `json:"country"`
		Images      []struct {
			URL string `json:"url"`
		} `json:"images"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil || strings.TrimSpace(payload.ID) == "" {
		return LibraryProfile{}, fmt.Errorf("Spotify profile was invalid")
	}
	image := ""
	if len(payload.Images) > 0 {
		image = strings.TrimSpace(payload.Images[0].URL)
	}
	return LibraryProfile{
		ID:          payload.ID,
		DisplayName: strings.TrimSpace(payload.DisplayName),
		Email:       strings.TrimSpace(payload.Email),
		ImageURL:    image,
		Product:     strings.TrimSpace(payload.Product),
		Country:     strings.TrimSpace(payload.Country),
	}, nil
}

func fetchLikedTotalGQL(client *http.Client, accessToken string) (int, error) {
	raw, err := graphqlPost(client, accessToken, "fetchLibraryTracks", hashFetchLibraryTracks, map[string]any{
		"offset": 0,
		"limit":  1,
	})
	if err != nil {
		return 0, err
	}
	tracks := asMap(asMap(asMap(asMap(raw["data"])["me"])["library"])["tracks"])
	return asInt(tracks["totalCount"]), nil
}

func fetchAllPlaylistsGQL(client *http.Client, accessToken string, onPage func(loaded, total int)) ([]LibraryPlaylist, error) {
	out := make([]LibraryPlaylist, 0, 64)
	total := 0
	for page := 0; page < maxPlaylistPages; page++ {
		offset := page * playlistPage
		raw, err := graphqlPost(client, accessToken, "libraryV3", hashLibraryV3, map[string]any{
			"filters":                     []string{"Playlists"},
			"order":                       nil,
			"textFilter":                  "",
			"features":                    []string{"LIKED_SONGS", "YOUR_EPISODES_V2", "PRERELEASES", "EVENTS"},
			"limit":                       playlistPage,
			"offset":                      offset,
			"flatten":                     true,
			"expandedFolders":             []any{},
			"folderUri":                   nil,
			"includeFoldersWhenFlattening": false,
		})
		if err != nil {
			return nil, err
		}
		library := asMap(asMap(asMap(raw["data"])["me"])["libraryV3"])
		if count := asInt(library["totalCount"]); count > total {
			total = count
		}
		items, _ := library["items"].([]any)
		pageCount := 0
		for _, item := range items {
			wrapper := asMap(asMap(item)["item"])
			typeName := asString(wrapper["__typename"])
			if typeName != "PlaylistResponseWrapper" && !strings.Contains(strings.ToLower(typeName), "playlist") {
				continue
			}
			playlist, ok := parsePlaylistWrapper(wrapper)
			if !ok {
				continue
			}
			out = append(out, playlist)
			pageCount++
		}
		if onPage != nil {
			onPage(len(out), total)
		}
		if pageCount == 0 || len(items) == 0 || (total > 0 && len(out) >= total) || len(items) < playlistPage {
			break
		}
	}
	return out, nil
}

func enrichPlaylistTrackCounts(client *http.Client, accessToken string, playlists []LibraryPlaylist, onProgress func(loaded int)) []LibraryPlaylist {
	if len(playlists) == 0 {
		return playlists
	}
	out := make([]LibraryPlaylist, len(playlists))
	copy(out, playlists)

	type job struct{ index int }
	jobs := make(chan job, len(out))
	for i := range out {
		if out[i].TrackCount > 0 || strings.TrimSpace(out[i].ID) == "" {
			continue
		}
		jobs <- job{index: i}
	}
	close(jobs)

	workers := maxCountWorkers
	if workers > len(out) {
		workers = len(out)
	}
	if workers < 1 {
		return out
	}

	var mu sync.Mutex
	done := 0
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range jobs {
				count, err := fetchPlaylistTrackCount(client, accessToken, out[item.index].ID)
				if err != nil || count < 0 {
					continue
				}
				mu.Lock()
				out[item.index].TrackCount = count
				done++
				loaded := done
				mu.Unlock()
				if onProgress != nil {
					onProgress(loaded)
				}
			}
		}()
	}
	wg.Wait()
	return out
}

func fetchPlaylistTrackCount(client *http.Client, accessToken, playlistID string) (int, error) {
	vars := map[string]any{
		"uri":                       "spotify:playlist:" + playlistID,
		"offset":                    0,
		"limit":                     1,
		"enableWatchFeedEntrypoint": false,
	}
	var lastErr error
	for _, hash := range hashFetchPlaylist {
		raw, err := graphqlPost(client, accessToken, "fetchPlaylist", hash, vars)
		if err != nil {
			lastErr = err
			continue
		}
		playlist := asMap(asMap(raw["data"])["playlistV2"])
		if len(playlist) == 0 {
			lastErr = fmt.Errorf("Spotify playlist was empty")
			continue
		}
		if n := playlistTrackCount(playlist); n > 0 {
			return n, nil
		}
		if n := asInt(asMap(playlist["content"])["totalCount"]); n >= 0 {
			return n, nil
		}
		return 0, nil
	}
	if lastErr != nil {
		return 0, lastErr
	}
	return 0, fmt.Errorf("Spotify playlist count unavailable")
}

func parsePlaylistWrapper(wrapper map[string]any) (LibraryPlaylist, bool) {
	data := asMap(wrapper["data"])
	if asString(data["__typename"]) != "Playlist" {
		return LibraryPlaylist{}, false
	}
	uri := asString(wrapper["_uri"])
	if uri == "" {
		uri = asString(data["uri"])
	}
	id := uri
	if i := strings.LastIndex(uri, ":"); i >= 0 {
		id = uri[i+1:]
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return LibraryPlaylist{}, false
	}
	name := strings.TrimSpace(asString(data["name"]))
	if name == "" {
		name = "Untitled playlist"
	}
	ownerData := asMap(asMap(data["ownerV2"])["data"])
	owner := strings.TrimSpace(asString(ownerData["name"]))
	image := playlistImageURL(asMap(data["images"]))
	return LibraryPlaylist{
		ID:         id,
		Name:       name,
		Owner:      owner,
		ImageURL:   image,
		TrackCount: playlistTrackCount(data),
	}, true
}

func playlistTrackCount(data map[string]any) int {
	for _, key := range []string{"content", "contents", "tracks", "tracksV2"} {
		if n := asInt(asMap(data[key])["totalCount"]); n > 0 {
			return n
		}
	}
	for _, key := range []string{"totalCount", "trackCount", "numTracks"} {
		if n := asInt(data[key]); n > 0 {
			return n
		}
	}
	return 0
}

func playlistImageURL(images map[string]any) string {
	items, _ := images["items"].([]any)
	for _, item := range items {
		if url := firstImageURL(asMap(item)["sources"]); url != "" {
			return url
		}
	}
	return firstImageURL(images["sources"])
}

func firstImageURL(raw any) string {
	arr, _ := raw.([]any)
	best := ""
	bestArea := -1
	for _, item := range arr {
		obj := asMap(item)
		url := strings.TrimSpace(asString(obj["url"]))
		if url == "" {
			continue
		}
		area := asInt(obj["width"]) * asInt(obj["height"])
		if area >= bestArea {
			bestArea = area
			best = url
		}
	}
	return best
}

func graphqlPost(client *http.Client, accessToken, operationName, hash string, variables map[string]any) (map[string]any, error) {
	if variables == nil {
		variables = map[string]any{}
	}
	payload := map[string]any{
		"operationName": operationName,
		"variables":     variables,
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

	var lastErr error
	for attempt := 0; attempt < maxGQLRetries; attempt++ {
		req, err := http.NewRequest(http.MethodPost, pathfinderQueryURL, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", "application/json;charset=UTF-8")
		req.Header.Set("Accept", "application/json")
		req.Header.Set("app-platform", "WebPlayer")
		req.Header.Set("Origin", "https://open.spotify.com")
		req.Header.Set("Referer", "https://open.spotify.com/")
		req.Header.Set("User-Agent", webUserAgent)

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("Spotify library request failed")
		}
		raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("Spotify library response could not be read")
		}

		if resp.StatusCode == http.StatusTooManyRequests {
			wait := retryAfterDuration(resp.Header.Get("Retry-After"), attempt)
			lastErr = fmt.Errorf("Spotify is busy — try again in a moment")
			time.Sleep(wait)
			continue
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return nil, fmt.Errorf("Spotify session expired — link again")
		}
		if resp.StatusCode == http.StatusPreconditionFailed {
			return nil, fmt.Errorf("Spotify library query needs an update")
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("Spotify library request was rejected")
		}

		var parsed map[string]any
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return nil, fmt.Errorf("Spotify library response was invalid")
		}
		if errs, ok := parsed["errors"].([]any); ok && len(errs) > 0 {
			msg := asString(asMap(errs[0])["message"])
			if strings.Contains(strings.ToLower(msg), "persistedquerynotfound") {
				return nil, fmt.Errorf("Spotify library query needs an update")
			}
			if msg == "" {
				msg = "Spotify library request failed"
			}
			return nil, fmt.Errorf("%s", msg)
		}
		if asMap(parsed["data"]) == nil {
			return nil, fmt.Errorf("Spotify library response was empty")
		}
		return parsed, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("Spotify is busy — try again in a moment")
}

func restGet(client *http.Client, accessToken, endpoint string) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt < maxGQLRetries; attempt++ {
		req, err := http.NewRequest(http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("app-platform", "WebPlayer")
		req.Header.Set("Origin", "https://open.spotify.com")
		req.Header.Set("Referer", "https://open.spotify.com/")
		req.Header.Set("User-Agent", webUserAgent)
		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("Spotify library request failed")
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("Spotify library response could not be read")
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			wait := retryAfterDuration(resp.Header.Get("Retry-After"), attempt)
			lastErr = fmt.Errorf("Spotify is busy — try again in a moment")
			time.Sleep(wait)
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("Spotify library request was rejected")
		}
		return body, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("Spotify is busy — try again in a moment")
}

func retryAfterDuration(header string, attempt int) time.Duration {
	header = strings.TrimSpace(header)
	if secs, err := strconv.Atoi(header); err == nil && secs > 0 {
		wait := time.Duration(secs) * time.Second
		if wait > 20*time.Second {
			wait = 20 * time.Second
		}
		if wait < time.Second {
			wait = time.Second
		}
		return wait
	}
	base := time.Duration(attempt+1) * 2 * time.Second
	if base > 8*time.Second {
		return 8 * time.Second
	}
	return base
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case fmt.Stringer:
		return t.String()
	default:
		return ""
	}
}

func asInt(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	case int64:
		return int(t)
	case json.Number:
		n, _ := t.Int64()
		return int(n)
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(t))
		return n
	default:
		return 0
	}
}
