package desktop

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"wisewave-runtime/internal/cache"
	"wisewave-runtime/internal/innertube"
	"wisewave-runtime/internal/lyrics"
	"wisewave-runtime/internal/models"
)

var videoID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

type Music struct {
	client  *innertube.Client
	lyrics  *lyrics.Service
	streams *cache.StreamCache
	http    *http.Client
}

func NewMusic() *Music {
	return NewMusicWithTokens(nil)
}

func NewMusicWithTokens(tokens func(context.Context, string, string) (string, string, error)) *Music {
	client := innertube.NewClientWithTokens(tokens)
	return &Music{client: client, lyrics: lyrics.NewService(client.MusicClient), streams: cache.NewStreamCache(), http: &http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, ResponseHeaderTimeout: 30 * time.Second}}}
}

func (m *Music) Search(query string) ([]models.Track, error) {
	query = strings.TrimSpace(query)
	if query == "" || len(query) > 512 {
		return nil, errors.New("Invalid search query")
	}
	tracks, err := m.client.Search(query)
	if err != nil {
		return nil, errors.New("Search is unavailable")
	}
	return tracks, nil
}

func (m *Music) Suggestions(query string) ([]string, error) {
	query = strings.TrimSpace(query)
	if query == "" || len(query) > 512 {
		return []string{}, nil
	}
	if m.client != nil && m.client.MusicClient != nil {
		sug, err := m.client.GetSearchSuggestions(context.Background(), query)
		if err == nil && sug != nil && len(sug.Queries) > 0 {
			return sug.Queries, nil
		}
	}
	return fetchPublicSuggestions(query)
}

func fetchPublicSuggestions(query string) ([]string, error) {
	reqURL := "https://suggestqueries-clients6.youtube.com/complete/search?client=firefox&ds=yt&q=" + url.QueryEscape(query)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return []string{}, nil
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return []string{}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return []string{}, nil
	}

	var data []interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil || len(data) < 2 {
		return []string{}, nil
	}

	rawSuggestions, ok := data[1].([]interface{})
	if !ok {
		return []string{}, nil
	}

	results := make([]string, 0, len(rawSuggestions))
	for _, item := range rawSuggestions {
		if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
			results = append(results, s)
		}
	}
	return results, nil
}

func (m *Music) Popular() ([]models.Track, error) {
	tracks, err := m.client.Popular()
	if err != nil {
		return nil, errors.New("Popular music is unavailable")
	}
	return tracks, nil
}

func (m *Music) Related(id string) ([]models.Track, error) {
	if !videoID.MatchString(id) {
		return nil, errors.New("Invalid track")
	}
	tracks, err := m.client.Related(id)
	if err != nil {
		return nil, errors.New("Recommendations are unavailable")
	}
	return tracks, nil
}

func (m *Music) Artist(id string) (*innertube.ArtistDetail, error) {
	if !innertube.ValidCatalogID(id, true) {
		return nil, errors.New("Invalid artist")
	}
	artist, err := m.client.Artist(id)
	if err != nil {
		return nil, errors.New("Artist is unavailable")
	}
	return artist, nil
}

func (m *Music) Album(id string) (*innertube.AlbumDetail, error) {
	if !innertube.ValidCatalogID(id, false) {
		return nil, errors.New("Invalid album")
	}
	album, err := m.client.Album(id)
	if err != nil {
		return nil, errors.New("Album is unavailable")
	}
	return album, nil
}

func (m *Music) Artists(name string) ([]innertube.CatalogArtist, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 512 {
		return nil, errors.New("Invalid artist")
	}
	result, err := m.client.SearchCatalog(name, true)
	if err != nil {
		return nil, errors.New("Artist is unavailable")
	}
	artists, ok := result.([]innertube.CatalogArtist)
	if !ok {
		return nil, errors.New("Artist is unavailable")
	}
	return artists, nil
}

func (m *Music) Albums(name string) ([]innertube.CatalogAlbum, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 512 {
		return nil, errors.New("Invalid album")
	}
	result, err := m.client.SearchCatalog(name, false)
	if err != nil {
		return nil, errors.New("Albums are unavailable")
	}
	albums, ok := result.([]innertube.CatalogAlbum)
	if !ok {
		return nil, errors.New("Albums are unavailable")
	}
	return albums, nil
}

func (m *Music) Lyrics(title, artist, album string, duration int, id string) (*lyrics.Record, error) {
	if !videoID.MatchString(id) || duration < 0 || duration > 86400 || len(title) > 1024 || len(artist) > 1024 || len(album) > 1024 {
		return nil, errors.New("Invalid track")
	}
	result, err := m.lyrics.FetchLyricsForTrack(lyrics.TrackMeta{Title: title, Artist: artist, Album: album, DurationSeconds: duration, VideoID: id})
	if err != nil {
		return nil, errors.New("Lyrics are unavailable")
	}
	return result, nil
}

func (m *Music) SponsorSegments(id string) ([]innertube.SponsorSegment, error) {
	if !videoID.MatchString(id) {
		return nil, errors.New("Invalid track")
	}
	return innertube.DefaultSponsorBlock.GetSegments(context.Background(), id)
}

func (m *Music) Charts() (*innertube.BrowseResult, error) {
	return m.client.GetCharts(context.Background())
}

func (m *Music) MoodsAndGenres() (*innertube.BrowseResult, error) {
	return m.client.GetMoodsAndGenres(context.Background())
}

func (m *Music) NewReleases() (*innertube.BrowseResult, error) {
	return m.client.GetNewReleases(context.Background())
}

type Audio struct{ Music *Music }

func (handler Audio) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	m := handler.Music
	id := strings.TrimPrefix(r.URL.Path, "/")
	if (r.Method != http.MethodGet && r.Method != http.MethodHead) || !videoID.MatchString(id) {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	stream, ok := m.streams.Get(id)
	if !ok {
		resolved, err := m.client.ResolveAudioStream(id)
		if err != nil {
			http.Error(w, "Audio unavailable", http.StatusBadGateway)
			return
		}
		m.streams.Put(id, *resolved)
		stream = resolved
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	doStream := func(streamURL string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, r.Method, streamURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
		if value := r.Header.Get("Range"); value != "" {
			req.Header.Set("Range", value)
		}
		return m.http.Do(req)
	}

	resp, err := doStream(stream.URL)
	if err != nil || (resp != nil && (resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusGone)) {
		if resp != nil {
			_ = resp.Body.Close()
		}
		m.streams.Invalidate(id)
		resolved, err := m.client.ResolveAudioStream(id)
		if err != nil {
			http.Error(w, "Audio unavailable", http.StatusBadGateway)
			return
		}
		m.streams.Put(id, *resolved)
		stream = resolved

		resp, err = doStream(stream.URL)
		if err != nil {
			http.Error(w, "Audio unavailable", http.StatusBadGateway)
			return
		}
	}
	body := innertube.WrapIfSABR(resp)
	defer body.Close()

	for _, name := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"} {
		if value := resp.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}
	if strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "application/vnd.yt-ump") || strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "application/yt-ump") {
		if stream != nil && stream.MimeType != "" {
			w.Header().Set("Content-Type", strings.Split(stream.MimeType, ";")[0])
		}
		w.Header().Del("Content-Length")
	}
	w.WriteHeader(resp.StatusCode)
	if r.Method != http.MethodHead {
		_, _ = io.Copy(w, body)
	}
}
