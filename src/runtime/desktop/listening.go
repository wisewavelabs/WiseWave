package desktop

import (
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
	"wisewave-runtime/internal/listening"
)

type Listening struct {
	store   *listening.Store
	openErr error
}

func NewListening() *Listening {
	path, err := listeningDBPath()
	if err != nil {
		log.Printf("listening history unavailable: %v", err)
		return &Listening{openErr: err}
	}
	store, err := listening.Open(path)
	if err != nil {
		log.Printf("listening history unavailable: %v", err)
		return &Listening{openErr: err}
	}
	return &Listening{store: store}
}

func listeningDBPath() (string, error) {
	if dir, err := mygo.App.Path(mygo.PathUserData); err == nil && strings.TrimSpace(dir) != "" {
		return filepath.Join(dir, "listening.db"), nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "WiseWave", "listening.db"), nil
}

func (l *Listening) ready() (*listening.Store, error) {
	if l == nil || l.store == nil {
		if l != nil && l.openErr != nil {
			return nil, l.openErr
		}
		return nil, errors.New("listening history is unavailable")
	}
	return l.store, nil
}

func (l *Listening) SetPrivate(on bool) {
	if l == nil || l.store == nil {
		return
	}
	l.store.SetPrivate(on)
}

func (l *Listening) Heartbeat(play listening.Heartbeat) error {
	store, err := l.ready()
	if err != nil {
		return err
	}
	return store.Heartbeat(play)
}

func (l *Listening) Finalize() error {
	store, err := l.ready()
	if err != nil {
		return err
	}
	return store.Finalize()
}

func (l *Listening) Discard() error {
	store, err := l.ready()
	if err != nil {
		return err
	}
	return store.Discard()
}

func (l *Listening) Overview(rangeName, timezone string) (listening.Overview, error) {
	store, err := l.ready()
	if err != nil {
		return listening.Overview{}, err
	}
	return store.Overview(rangeName, timezone)
}

func (l *Listening) Activity(rangeName, timezone string) (listening.Activity, error) {
	store, err := l.ready()
	if err != nil {
		return listening.Activity{}, err
	}
	return store.Activity(rangeName, timezone)
}

func (l *Listening) Heatmap(year int, timezone string) (listening.Heatmap, error) {
	store, err := l.ready()
	if err != nil {
		return listening.Heatmap{}, err
	}
	return store.Heatmap(year, timezone)
}

func (l *Listening) TopTracks(rangeName, timezone string, limit, offset int) ([]listening.TopTrack, error) {
	store, err := l.ready()
	if err != nil {
		return nil, err
	}
	return store.TopTracks(rangeName, timezone, limit, offset)
}

func (l *Listening) TopArtists(rangeName, timezone string, limit, offset int) ([]listening.TopArtist, error) {
	store, err := l.ready()
	if err != nil {
		return nil, err
	}
	return store.TopArtists(rangeName, timezone, limit, offset)
}

func (l *Listening) TopAlbums(rangeName, timezone string, limit, offset int) ([]listening.TopAlbum, error) {
	store, err := l.ready()
	if err != nil {
		return nil, err
	}
	return store.TopAlbums(rangeName, timezone, limit, offset)
}

func (l *Listening) History(query string, fromMs, toMs int64, timezone string, limit, offset int) (listening.HistoryPage, error) {
	store, err := l.ready()
	if err != nil {
		return listening.HistoryPage{}, err
	}
	return store.History(query, fromMs, toMs, timezone, limit, offset)
}

func (l *Listening) Sessions(rangeName, timezone string, limit, offset int) (listening.SessionPage, error) {
	store, err := l.ready()
	if err != nil {
		return listening.SessionPage{}, err
	}
	return store.Sessions(rangeName, timezone, limit, offset)
}

func (l *Listening) Session(id string) (listening.SessionDetail, error) {
	store, err := l.ready()
	if err != nil {
		return listening.SessionDetail{}, err
	}
	return store.Session(id)
}

func (l *Listening) Insights(rangeName, timezone string) ([]listening.Insight, error) {
	store, err := l.ready()
	if err != nil {
		return nil, err
	}
	return store.Insights(rangeName, timezone)
}

func (l *Listening) Rewind(kind string, year, month int, timezone string) (listening.Rewind, error) {
	store, err := l.ready()
	if err != nil {
		return listening.Rewind{}, err
	}
	return store.Rewind(kind, year, month, timezone)
}

func (l *Listening) Clear() error {
	store, err := l.ready()
	if err != nil {
		return err
	}
	return store.Clear()
}
