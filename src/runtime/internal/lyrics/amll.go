package lyrics

import (
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var spotifyIDPattern = regexp.MustCompile(`^[a-zA-Z0-9]{22}$`)

type AmllProvider struct {
	httpClient *http.Client
}

func NewAmllProvider() *AmllProvider {
	return &AmllProvider{
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (a *AmllProvider) Name() string {
	return "amll"
}

func (a *AmllProvider) Fetch(meta TrackMeta) (*LyricsDocument, error) {
	if meta.SpotifyID == "" || !spotifyIDPattern.MatchString(meta.SpotifyID) {
		return nil, fmt.Errorf("valid 22-character spotify id required for amll")
	}

	url := fmt.Sprintf("https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/spotify-lyrics/%s.ttml", meta.SpotifyID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "WiseWave/1.0 (Android; AMLL)")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("amll returned %d for %s", resp.StatusCode, meta.SpotifyID)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	lines, ttmlMeta, err := ParseTtml(string(body))
	if err != nil || len(lines) == 0 {
		return nil, fmt.Errorf("failed to parse amll ttml")
	}

	trackName := meta.Title
	if len(ttmlMeta.MusicName) > 0 && trackName == "" {
		trackName = ttmlMeta.MusicName[0]
	}

	artistName := meta.Artist
	if len(ttmlMeta.Artists) > 0 && artistName == "" {
		artistName = strings.Join(ttmlMeta.Artists, ", ")
	}

	docType := "line"
	for _, line := range lines {
		if len(line.Syllables) > 0 {
			docType = "syllable"
			break
		}
	}

	return &LyricsDocument{
		Source:       "amll",
		Type:         docType,
		TrackName:    trackName,
		ArtistName:   artistName,
		SyncedLyrics: BuildSyncedLrc(lines),
		PlainLyrics:  BuildPlainLyrics(lines),
		Lines:        lines,
	}, nil
}
