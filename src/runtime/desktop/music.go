package desktop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"wisewave-runtime/internal/cache"
	"wisewave-runtime/internal/external/gaana"
	"wisewave-runtime/internal/external/jiosaavn"
	"wisewave-runtime/internal/external/spotify"
	"wisewave-runtime/internal/innertube"
	"wisewave-runtime/internal/lyrics"
	"wisewave-runtime/internal/models"
)

var videoID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
var spotifyTrackID = regexp.MustCompile(`^[A-Za-z0-9]{22}$`)
var trackTextNoise = regexp.MustCompile(`[^a-z0-9 ]+`)
var audioErrorURL = regexp.MustCompile(`https?://[^\s"'<>]+`)

func audioFailureDiagnostic(err error) string {
	message := audioErrorURL.ReplaceAllString(err.Error(), "<url>")
	message = strings.Map(func(r rune) rune {
		if r < ' ' || r == 127 {
			return ' '
		}
		return r
	}, message)
	if len(message) > 1600 {
		message = message[:1600]
	}
	return message
}

type Music struct {
	client  *innertube.Client
	saavn   *jiosaavn.Client
	gaana   *gaana.Client
	spotify *spotify.Client
	lyrics  *lyrics.Service
	streams *cache.StreamCache
	http    *http.Client
}

func NewMusic() *Music {
	return NewMusicWithTokens(nil)
}

func NewMusicWithTokens(tokens func(context.Context, string, string) (string, string, error)) *Music {
	client := innertube.NewClientWithTokens(tokens)
	return &Music{client: client, saavn: jiosaavn.NewClient(), gaana: gaana.NewClient(), spotify: spotify.NewClient(), lyrics: lyrics.NewService(client.MusicClient), streams: cache.NewStreamCache(), http: &http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, ResponseHeaderTimeout: 30 * time.Second}}}
}

func (m *Music) ResolveLink(raw string) (*models.Track, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.User != nil {
		return nil, errors.New("unsupported music link")
	}
	host := strings.ToLower(strings.TrimPrefix(parsed.Hostname(), "www."))
	var title, artist string
	switch host {
	case "open.spotify.com":
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		if len(parts) == 3 && strings.HasPrefix(parts[0], "intl-") {
			parts = parts[1:]
		}
		if len(parts) < 2 || parts[0] != "track" || !spotifyTrackID.MatchString(parts[1]) {
			return nil, errors.New("unsupported Spotify link")
		}
		track, err := m.spotify.GetTrack(parts[1])
		if err != nil {
			return nil, errors.New("Spotify track could not be read")
		}
		title, artist = track.Title, track.Artist
	case "gaana.com":
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		if len(parts) != 2 || parts[0] != "song" {
			return nil, errors.New("unsupported Gaana link")
		}
		title = strings.ReplaceAll(parts[1], "-", " ")
	case "jiosaavn.com":
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		if len(parts) < 3 || parts[0] != "song" {
			return nil, errors.New("unsupported JioSaavn link")
		}
		title = strings.ReplaceAll(parts[1], "-", " ")
	default:
		return nil, errors.New("unsupported music link")
	}
	if title == "" {
		return nil, errors.New("music link has no track title")
	}
	query := strings.TrimSpace(title + " " + artist)
	candidates := make([]models.Track, 0, 12)
	if tracks, err := m.client.Search(query); err == nil {
		candidates = append(candidates, tracks...)
	}
	if tracks, err := m.saavn.Search(query); err == nil {
		candidates = append(candidates, tracks...)
	}
	if tracks, err := m.gaana.Search(query); err == nil {
		candidates = append(candidates, tracks...)
	}
	if len(candidates) == 0 {
		return nil, errors.New("no playable match found for this link")
	}
	best := -1
	bestScore := -1
	needle := normalizeTrackText(title)
	for i := range candidates {
		candidate := &candidates[i]
		if !validTrackID(candidate.ID) {
			continue
		}
		candidateTitle := normalizeTrackText(candidate.Title)
		if candidateTitle == "" {
			continue
		}
		score := 0
		if candidateTitle == needle {
			score += 100
		}
		if artist != "" && strings.Contains(normalizeTrackText(candidate.Artist), normalizeTrackText(artist)) {
			score += 25
		}
		if score > bestScore {
			best, bestScore = i, score
		}
	}
	if best < 0 || bestScore < 100 {
		return nil, errors.New("no playable match found for this link")
	}
	return &candidates[best], nil
}

func normalizeTrackText(value string) string {
	value = strings.ToLower(value)
	return strings.Join(strings.Fields(trackTextNoise.ReplaceAllString(value, " ")), " ")
}

func (m *Music) resolveAudio(ctx context.Context, id string, maxBitrate int) (*innertube.ResolvedAudioStream, error) {
	switch {
	case strings.HasPrefix(id, "saavn:") || strings.HasPrefix(id, "jiosaavn:"):
		if !validSourceID(id, "saavn:") && !validSourceID(id, "jiosaavn:") {
			return nil, errors.New("invalid JioSaavn track ID")
		}
		return m.saavn.ResolveAudioStream(id)
	case strings.HasPrefix(id, "gaana:"):
		if !validSourceID(id, "gaana:") {
			return nil, errors.New("invalid Gaana track ID")
		}
		return m.gaana.ResolveAudioStream(id)
	case videoID.MatchString(id):
		var failures []error
		for _, options := range []innertube.StreamOptions{
			{PreferredCodec: innertube.CodecOpus, RequireCodec: true, Validate: true, MaxBitrate: maxBitrate},
			{PreferredCodec: innertube.CodecAAC, RequireCodec: true, Validate: true, MaxBitrate: maxBitrate},
			{PreferredCodec: innertube.CodecAny, Validate: true, MaxBitrate: maxBitrate},
		} {
			stream, err := m.client.ResolveAudio(ctx, id, options)
			if err == nil {
				return stream, nil
			}
			failures = append(failures, fmt.Errorf("codec %d: %w", options.PreferredCodec, err))
		}
		return nil, fmt.Errorf("no supported audio format found: %w", errors.Join(failures...))
	default:
		return nil, errors.New("unsupported track source")
	}
}

func validSourceID(id, prefix string) bool {
	value := strings.TrimPrefix(id, prefix)
	return value != id && value != "" && len(value) <= 128 && !strings.ContainsAny(value, "/\\?#")
}

func validTrackID(id string) bool {
	return videoID.MatchString(id) || validSourceID(id, "saavn:") || validSourceID(id, "jiosaavn:") || validSourceID(id, "gaana:")
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
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		sug, err := m.client.GetSearchSuggestions(ctx, query)
		if err == nil && sug != nil && len(sug.Queries) > 0 {
			return sug.Queries, nil
		}
	}
	if m.client != nil {
		if local := m.client.LocalSearchSuggestions(query); len(local) > 0 {
			return local, nil
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
	result, err := m.client.SearchCatalog(name, "artists")
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
	result, err := m.client.SearchCatalog(name, "albums")
	if err != nil {
		return nil, errors.New("Albums are unavailable")
	}
	albums, ok := result.([]innertube.CatalogAlbum)
	if !ok {
		return nil, errors.New("Albums are unavailable")
	}
	return albums, nil
}

func (m *Music) Playlists(name string) ([]innertube.CatalogPlaylist, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 512 {
		return nil, errors.New("Invalid playlist")
	}
	result, err := m.client.SearchCatalog(name, "playlists")
	if err != nil {
		return nil, errors.New("Playlists are unavailable")
	}
	playlists, ok := result.([]innertube.CatalogPlaylist)
	if !ok {
		return nil, errors.New("Playlists are unavailable")
	}
	return playlists, nil
}

func (m *Music) Playlist(id string) (*innertube.PlaylistDetail, error) {
	id = strings.TrimSpace(id)
	if id == "" || len(id) > 200 {
		return nil, errors.New("Invalid playlist")
	}
	playlist, err := m.client.Playlist(id)
	if err != nil {
		return nil, errors.New("Playlist is unavailable")
	}
	return playlist, nil
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

type CanvasResult struct {
	URL string `json:"url"`
}

func (m *Music) Canvas(title, artist string, duration int, id string) (*CanvasResult, error) {
	title = strings.TrimSpace(title)
	artist = strings.TrimSpace(artist)
	if title == "" || len(title) > 1024 || len(artist) > 1024 || duration < 0 || duration > 86400 {
		return nil, errors.New("Invalid track")
	}
	if strings.HasPrefix(id, "spotify:") || spotifyTrackID.MatchString(strings.TrimPrefix(id, "spotify:track:")) {
		trackID := strings.TrimPrefix(id, "spotify:track:")
		trackID = strings.TrimPrefix(trackID, "spotify:")
		canvas, err := m.spotify.GetCanvas(trackID)
		if err != nil || canvas == nil || canvas.URL == "" {
			return nil, errors.New("Canvas unavailable")
		}
		return &CanvasResult{URL: canvas.URL}, nil
	}
	canvas, err := m.spotify.ResolveCanvas(title, artist, duration)
	if err != nil || canvas == nil || canvas.URL == "" {
		return nil, errors.New("Canvas unavailable")
	}
	return &CanvasResult{URL: canvas.URL}, nil
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
	if (r.Method != http.MethodGet && r.Method != http.MethodHead) || !validTrackID(id) {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	stream, ok := m.streams.Get(id)
	if !ok {
		resolved, err := m.resolveAudio(r.Context(), id, 0)
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
		resolved, err := m.resolveAudio(ctx, id, 0)
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

func WireListeningSearch(listening *Listening, music *Music) {
	if listening == nil || listening.store == nil || music == nil || music.client == nil {
		return
	}
	music.client.MusicClient.SetSearchPreferences(func() func(models.Track) float64 {
		scores, err := listening.store.SearchPreferences()
		if err != nil || len(scores) == 0 {
			return nil
		}
		return func(track models.Track) float64 {
			if track.IsFavorite {
				return 1
			}
			return scores[track.ID]
		}
	})
}
