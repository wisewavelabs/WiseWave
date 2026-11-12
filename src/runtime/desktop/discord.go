package desktop

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"wisewave-runtime/internal/discord"
)

var multiArtistPattern = regexp.MustCompile(`(?i)(?:,|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring)\s+)`)

func isSingleArtist(artist string) bool {
	trimmed := strings.TrimSpace(artist)
	if trimmed == "" {
		return false
	}
	return !multiArtistPattern.MatchString(trimmed)
}

const discordPresenceApplicationID = "1560537420376707092"

type DiscordState struct {
	TrackID     string  `json:"track_id"`
	Title       string  `json:"title"`
	Artist      string  `json:"artist"`
	ArtistID    string  `json:"artist_id"`
	ArtworkURL  string  `json:"artwork_url"`
	Position    float64 `json:"position"`
	Duration    float64 `json:"duration"`
	SeekVersion uint64  `json:"seek_version"`
	Playing     bool    `json:"playing"`
	ButtonLabel string  `json:"button_label,omitempty"`
	ButtonURL   string  `json:"button_url,omitempty"`
}

type Discord struct {
	mu      sync.Mutex
	session *discord.Session
	appID   string
	enabled bool
}

func NewDiscord() *Discord {
	return &Discord{
		appID: discordPresenceApplicationID,
	}
}

func (d *Discord) SetEnabled(enabled bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.enabled = enabled
	if !enabled && d.session != nil {
		d.session.Close()
		d.session = nil
	}
}

func (d *Discord) IsEnabled() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.enabled
}

func (d *Discord) Update(state DiscordState) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.enabled {
		if d.session != nil {
			d.session.Close()
			d.session = nil
		}
		return
	}
	if !state.Playing || state.TrackID == "" {
		if d.session != nil {
			d.session.Update(discord.State{})
		}
		return
	}
	if d.session == nil {
		id, err := discord.ParseApplicationID(d.appID)
		if err != nil {
			return
		}
		d.session = discord.New(id)
	}

	songURL := ""
	if state.TrackID != "" {
		songURL = fmt.Sprintf("https://music.youtube.com/watch?v=%s", state.TrackID)
	}
	artistURL := ""
	if isSingleArtist(state.Artist) {
		if state.ArtistID != "" {
			if strings.HasPrefix(state.ArtistID, "UC") || strings.HasPrefix(state.ArtistID, "FE") {
				artistURL = fmt.Sprintf("https://music.youtube.com/channel/%s", state.ArtistID)
			} else {
				artistURL = fmt.Sprintf("https://music.youtube.com/browse/%s", state.ArtistID)
			}
		} else if state.Artist != "" {
			artistURL = fmt.Sprintf("https://music.youtube.com/search?q=%s", url.QueryEscape(state.Artist))
		}
	}

	d.session.Update(discord.State{
		VideoID:     state.TrackID,
		Title:       state.Title,
		Artist:      state.Artist,
		SongURL:     songURL,
		ArtistURL:   artistURL,
		ArtworkURL:  state.ArtworkURL,
		Position:    time.Duration(state.Position * float64(time.Second)),
		Duration:    time.Duration(state.Duration * float64(time.Second)),
		SeekVersion: state.SeekVersion,
		Playing:     state.Playing,
	})
}

func (d *Discord) Close() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.session != nil {
		d.session.Close()
		d.session = nil
	}
}
