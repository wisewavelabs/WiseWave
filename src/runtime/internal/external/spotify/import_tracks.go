package spotify

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	trackPageSize = 50
	maxTrackPages = 400
)

type SourceTrack struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	FirstArtist string `json:"first_artist"`
	DurationMs  int    `json:"duration_ms"`
}

func FetchLikedTracks(spDc, spKey string, onPage func(loaded, total int)) ([]SourceTrack, error) {
	token, err := FetchTokenFromCookie(spDc, spKey)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	return fetchAllLikedTracks(client, strings.TrimSpace(token.AccessToken), onPage)
}

func FetchPlaylistTracks(spDc, spKey, playlistID string, onPage func(loaded, total int)) ([]SourceTrack, error) {
	playlistID = strings.TrimSpace(playlistID)
	if playlistID == "" {
		return nil, fmt.Errorf("playlist is missing")
	}
	token, err := FetchTokenFromCookie(spDc, spKey)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	return fetchAllPlaylistTracks(client, strings.TrimSpace(token.AccessToken), playlistID, onPage)
}

func fetchAllLikedTracks(client *http.Client, accessToken string, onPage func(loaded, total int)) ([]SourceTrack, error) {
	out := make([]SourceTrack, 0, 128)
	total := 0
	for page := 0; page < maxTrackPages; page++ {
		offset := page * trackPageSize
		raw, err := graphqlPost(client, accessToken, "fetchLibraryTracks", hashFetchLibraryTracks, map[string]any{
			"offset": offset,
			"limit":  trackPageSize,
		})
		if err != nil {
			return nil, err
		}
		tracksNode := asMap(asMap(asMap(asMap(raw["data"])["me"])["library"])["tracks"])
		if n := asInt(tracksNode["totalCount"]); n > total {
			total = n
		}
		items, _ := tracksNode["items"].([]any)
		pageCount := 0
		for _, item := range items {
			wrapper := asMap(asMap(item)["track"])
			data := asMap(wrapper["data"])
			uri := asString(wrapper["_uri"])
			if uri == "" {
				uri = asString(wrapper["uri"])
			}
			track, ok := parseSourceTrack(data, uri)
			if !ok {
				continue
			}
			out = append(out, track)
			pageCount++
		}
		if onPage != nil {
			onPage(len(out), total)
		}
		if pageCount == 0 || len(items) == 0 || (total > 0 && len(out) >= total) || len(items) < trackPageSize {
			break
		}
	}
	return out, nil
}

func fetchAllPlaylistTracks(client *http.Client, accessToken, playlistID string, onPage func(loaded, total int)) ([]SourceTrack, error) {
	out := make([]SourceTrack, 0, 128)
	total := 0
	varsBase := map[string]any{
		"uri":                       "spotify:playlist:" + playlistID,
		"enableWatchFeedEntrypoint": false,
	}
	for page := 0; page < maxTrackPages; page++ {
		offset := page * trackPageSize
		vars := map[string]any{
			"uri":                       varsBase["uri"],
			"offset":                    offset,
			"limit":                     trackPageSize,
			"enableWatchFeedEntrypoint": false,
		}
		var raw map[string]any
		var err error
		for _, hash := range hashFetchPlaylist {
			raw, err = graphqlPost(client, accessToken, "fetchPlaylist", hash, vars)
			if err == nil {
				break
			}
		}
		if err != nil {
			return nil, err
		}
		content := asMap(asMap(asMap(raw["data"])["playlistV2"])["content"])
		if n := asInt(content["totalCount"]); n > total {
			total = n
		}
		items, _ := content["items"].([]any)
		pageCount := 0
		for _, item := range items {
			entry := asMap(item)
			wrapper := asMap(entry["itemV2"])
			if len(wrapper) == 0 {
				wrapper = asMap(entry["item"])
			}
			data := asMap(wrapper["data"])
			if asString(data["__typename"]) != "" && asString(data["__typename"]) != "Track" {
				continue
			}
			uri := asString(wrapper["_uri"])
			if uri == "" {
				uri = asString(wrapper["uri"])
			}
			track, ok := parseSourceTrack(data, uri)
			if !ok {
				continue
			}
			out = append(out, track)
			pageCount++
		}
		if onPage != nil {
			onPage(len(out), total)
		}
		if pageCount == 0 || len(items) == 0 || (total > 0 && len(out) >= total) || len(items) < trackPageSize {
			break
		}
	}
	return out, nil
}

func parseSourceTrack(data map[string]any, uriOverride string) (SourceTrack, bool) {
	if len(data) == 0 {
		return SourceTrack{}, false
	}
	uri := strings.TrimSpace(uriOverride)
	if uri == "" {
		uri = asString(data["uri"])
	}
	if uri == "" {
		uri = asString(data["_uri"])
	}
	id := uri
	if i := strings.LastIndex(uri, ":"); i >= 0 {
		id = uri[i+1:]
	}
	title := strings.TrimSpace(asString(data["name"]))
	if title == "" || strings.TrimSpace(id) == "" {
		return SourceTrack{}, false
	}
	artists := make([]string, 0, 4)
	artistItems, _ := asMap(data["artists"])["items"].([]any)
	for _, item := range artistItems {
		name := strings.TrimSpace(asString(asMap(asMap(item)["profile"])["name"]))
		if name == "" {
			name = strings.TrimSpace(asString(asMap(item)["name"]))
		}
		if name != "" {
			artists = append(artists, name)
		}
	}
	first := ""
	if len(artists) > 0 {
		first = artists[0]
	}
	return SourceTrack{
		ID:          strings.TrimSpace(id),
		Title:       title,
		Artist:      strings.Join(artists, " "),
		FirstArtist: first,
		DurationMs:  parseDurationMs(data),
	}, true
}

func parseDurationMs(data map[string]any) int {
	for _, key := range []string{"trackDuration", "duration"} {
		if n := asInt(asMap(data[key])["totalMilliseconds"]); n > 0 {
			return n
		}
	}
	for _, key := range []string{"durationMs", "duration_ms"} {
		if n := asInt(data[key]); n > 0 {
			return n
		}
	}
	if n := asInt(data["duration"]); n > 0 && n < 10000 {
		return n * 1000
	}
	return 0
}

func BuildSearchQuery(track SourceTrack) string {
	artist := strings.TrimSpace(track.FirstArtist)
	if artist == "" {
		artist = strings.TrimSpace(track.Artist)
	}
	title := strings.TrimSpace(track.Title)
	if artist == "" {
		return title
	}
	return artist + " " + title
}
