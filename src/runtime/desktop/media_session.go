package desktop

import (
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

var MediaAction = mygo.NewEvent[string]("media-action")

type MediaSessionState struct {
	TrackID     string  `json:"track_id"`
	Title       string  `json:"title"`
	Artist      string  `json:"artist"`
	Album       string  `json:"album"`
	ArtworkURL  string  `json:"artwork_url"`
	Position    float64 `json:"position"`
	Duration    float64 `json:"duration"`
	Playing     bool    `json:"playing"`
	CanNext     bool    `json:"can_next"`
	CanPrevious bool    `json:"can_previous"`
}

type MediaSession struct {
	mu          sync.Mutex
	playback    *Playback
	http        *http.Client
	commandsOff func()
	lastID      string
	lastTitle   string
	lastArtist  string
	lastAlbum   string
	lastArtURL  string
	lastArt     []byte
	lastNext    bool
	lastPrev    bool
	lastPlaying bool
	lastDur     float64
}

func NewMediaSession(playback *Playback) *MediaSession {
	session := &MediaSession{
		playback: playback,
		http:     &http.Client{Timeout: 8 * time.Second},
	}
	session.commandsOff = mygo.NowPlaying.OnCommand(session.onCommand)
	return session
}

func (m *MediaSession) Clear() {
	m.mu.Lock()
	m.lastID = ""
	m.lastTitle = ""
	m.lastArtist = ""
	m.lastAlbum = ""
	m.lastArtURL = ""
	m.lastArt = nil
	m.lastNext = false
	m.lastPrev = false
	m.lastPlaying = false
	m.lastDur = 0
	m.mu.Unlock()
	mygo.NowPlaying.Clear()
}

func (m *MediaSession) Update(state MediaSessionState) {
	if state.TrackID == "" {
		m.Clear()
		return
	}

	position := time.Duration(max(0, state.Position) * float64(time.Second))
	duration := time.Duration(max(0, state.Duration) * float64(time.Second))
	playbackState := mygo.PlaybackPaused
	if state.Playing {
		playbackState = mygo.PlaybackPlaying
	}
	commands := mygo.MediaPlay | mygo.MediaPause | mygo.MediaSeek
	if state.CanNext {
		commands |= mygo.MediaNext
	}
	if state.CanPrevious {
		commands |= mygo.MediaPrevious
	}

	m.mu.Lock()
	metaChanged := state.TrackID != m.lastID || state.Title != m.lastTitle || state.Artist != m.lastArtist || state.Album != m.lastAlbum || state.ArtworkURL != m.lastArtURL || state.CanNext != m.lastNext || state.CanPrevious != m.lastPrev || state.Duration != m.lastDur
	artwork := m.lastArt
	artURL := state.ArtworkURL
	needArt := state.ArtworkURL != "" && state.ArtworkURL != m.lastArtURL
	m.mu.Unlock()

	if needArt {
		if data := fetchArtwork(m.http, state.ArtworkURL); len(data) > 0 {
			artwork = data
		} else {
			artwork = nil
		}
	}

	if metaChanged || needArt {
		mygo.NowPlaying.Set(mygo.NowPlayingInfo{
			Title:    state.Title,
			Artist:   state.Artist,
			Album:    state.Album,
			Artwork:  artwork,
			Duration: duration,
			Position: position,
			State:    playbackState,
			Commands: commands,
		})
		m.mu.Lock()
		m.lastID = state.TrackID
		m.lastTitle = state.Title
		m.lastArtist = state.Artist
		m.lastAlbum = state.Album
		m.lastArtURL = artURL
		m.lastArt = artwork
		m.lastNext = state.CanNext
		m.lastPrev = state.CanPrevious
		m.lastPlaying = state.Playing
		m.lastDur = state.Duration
		m.mu.Unlock()
		return
	}

	m.mu.Lock()
	playingChanged := state.Playing != m.lastPlaying
	m.lastPlaying = state.Playing
	m.mu.Unlock()
	if playingChanged {
		mygo.NowPlaying.SetPlayback(playbackState, position)
	}
}

func (m *MediaSession) onCommand(cmd mygo.MediaCommand, position time.Duration) {
	switch cmd {
	case mygo.MediaPlay:
		_ = MediaAction.Broadcast("play")
	case mygo.MediaPause, mygo.MediaStop:
		_ = MediaAction.Broadcast("pause")
	case mygo.MediaNext:
		_ = MediaAction.Broadcast("next")
	case mygo.MediaPrevious:
		_ = MediaAction.Broadcast("previous")
	case mygo.MediaSeek:
		if m.playback != nil {
			m.playback.Seek(position.Seconds())
		}
		mygo.NowPlaying.SetPlayback(mygo.PlaybackPlaying, position)
		_ = MediaAction.Broadcast("seek")
	}
}

func fetchArtwork(client *http.Client, rawURL string) []byte {
	if client == nil || rawURL == "" {
		return nil
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "WiseWave/1.0")
	res, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil || len(data) == 0 {
		return nil
	}
	return data
}
