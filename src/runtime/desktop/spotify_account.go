package desktop

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/egoist/mygo"
	"wisewave-runtime/internal/external/spotify"
	"wisewave-runtime/internal/secret"
)

var SpotifyAccountChanged = mygo.NewEvent[bool]("spotify-account-changed")
var SpotifyLibrarySyncChanged = mygo.NewEvent[SpotifySyncStatus]("spotify-library-sync-changed")

type SpotifyAccountStatus struct {
	Linked      bool   `json:"linked"`
	DisplayName string `json:"display_name"`
	ImageURL    string `json:"image_url"`
}

type SpotifyLoginConnection struct {
	Status     SpotifyAccountStatus `json:"status"`
	Generation uint64               `json:"generation"`
}

type SpotifyLibraryPlaylist struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Owner      string `json:"owner"`
	ImageURL   string `json:"image_url"`
	TrackCount int    `json:"track_count"`
}

type SpotifyLibrarySnapshot struct {
	DisplayName   string                   `json:"display_name"`
	UserID        string                   `json:"user_id"`
	Email         string                   `json:"email"`
	ImageURL      string                   `json:"image_url"`
	Product       string                   `json:"product"`
	Country       string                   `json:"country"`
	LikedSongs    int                      `json:"liked_songs"`
	PlaylistCount int                      `json:"playlist_count"`
	Playlists     []SpotifyLibraryPlaylist `json:"playlists"`
}

type SpotifySyncStatus struct {
	Phase           string                  `json:"phase"`
	Label           string                  `json:"label"`
	DisplayName     string                  `json:"display_name"`
	ImageURL        string                  `json:"image_url"`
	PlaylistsLoaded int                     `json:"playlists_loaded"`
	PlaylistTotal   int                     `json:"playlist_total"`
	LikedSongs      int                     `json:"liked_songs"`
	Error           string                  `json:"error"`
	Library         *SpotifyLibrarySnapshot `json:"library"`
}

type spotifyAccountFile struct {
	Version        int                     `json:"version,omitempty"`
	SpDc           string                  `json:"sp_dc,omitempty"`
	SpKey          string                  `json:"sp_key,omitempty"`
	SpDcProtected  string                  `json:"sp_dc_protected,omitempty"`
	SpKeyProtected string                  `json:"sp_key_protected,omitempty"`
	DisplayName    string                  `json:"display_name"`
	ImageURL       string                  `json:"image_url"`
	Library        *SpotifyLibrarySnapshot `json:"library,omitempty"`
}

const spotifyAccountFileVersion = 2

type SpotifyAccount struct {
	mu            sync.Mutex
	storageMu     sync.Mutex
	epoch         uint64
	spDc          string
	spKey         string
	displayName   string
	imageURL      string
	path          string
	syncing       bool
	syncErr       string
	library       *SpotifyLibrarySnapshot
	playlistsN    int
	playlistTot   int
	likedSongs    int
	search        trackSearcher
	importing     bool
	importErr     string
	importSource  string
	importDone    int
	importTotal   int
	importMatched int
}

func NewSpotifyAccount() *SpotifyAccount {
	path, err := spotifyAccountPath()
	account := &SpotifyAccount{path: path}
	if err != nil {
		log.Printf("spotify account storage unavailable: %v", err)
		return account
	}
	if err := account.load(); err != nil {
		log.Printf("spotify account could not be loaded: %v", err)
	}
	return account
}

func spotifyAccountPath() (string, error) {
	if dir, err := mygo.App.Path(mygo.PathUserData); err == nil && strings.TrimSpace(dir) != "" {
		return filepath.Join(dir, "spotify-account.json"), nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "WiseWave", "spotify-account.json"), nil
}

func (a *SpotifyAccount) Status() SpotifyAccountStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	return SpotifyAccountStatus{
		Linked:      strings.TrimSpace(a.spDc) != "",
		DisplayName: a.displayName,
		ImageURL:    a.imageURL,
	}
}

func (a *SpotifyAccount) SyncStatus() SpotifySyncStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.syncStatusLocked()
}

func (a *SpotifyAccount) Library() *SpotifyLibrarySnapshot {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.library
}

func (a *SpotifyAccount) Connect(spDc string, spKey string) (SpotifyAccountStatus, error) {
	status, _, err := a.connect(spDc, spKey)
	return status, err
}

func (a *SpotifyAccount) ConnectForLogin(spDc string, spKey string) (SpotifyLoginConnection, error) {
	status, generation, err := a.connect(spDc, spKey)
	if err != nil {
		return SpotifyLoginConnection{}, err
	}
	return SpotifyLoginConnection{Status: status, Generation: generation}, nil
}

func (a *SpotifyAccount) connect(spDc string, spKey string) (SpotifyAccountStatus, uint64, error) {
	spDc = strings.TrimSpace(spDc)
	spDc = strings.TrimPrefix(spDc, "sp_dc=")
	spKey = strings.TrimSpace(strings.TrimPrefix(spKey, "sp_key="))
	if spDc == "" {
		return SpotifyAccountStatus{}, 0, errors.New("Spotify login did not finish")
	}
	if _, err := spotify.FetchTokenFromCookie(spDc, spKey); err != nil {
		return SpotifyAccountStatus{}, 0, err
	}
	a.mu.Lock()
	a.epoch++
	a.spDc = spDc
	a.spKey = spKey
	a.displayName = ""
	a.imageURL = ""
	a.library = nil
	a.syncErr = ""
	a.syncing = false
	a.playlistsN = 0
	a.playlistTot = 0
	a.likedSongs = 0
	status := SpotifyAccountStatus{Linked: true}
	epoch := a.epoch
	a.mu.Unlock()
	if err := a.persist(); err != nil {
		a.mu.Lock()
		if a.epoch == epoch {
			a.epoch++
			a.spDc = ""
			a.spKey = ""
		}
		a.mu.Unlock()
		return SpotifyAccountStatus{}, 0, err
	}
	_ = SpotifyAccountChanged.Broadcast(true)
	a.emitSync()
	return status, epoch, nil
}

func (a *SpotifyAccount) SyncLibrary() (SpotifySyncStatus, error) {
	a.mu.Lock()
	spDc := a.spDc
	spKey := a.spKey
	epoch := a.epoch
	if strings.TrimSpace(spDc) == "" {
		a.mu.Unlock()
		return SpotifySyncStatus{}, errors.New("Spotify is not linked")
	}
	if a.syncing {
		status := a.syncStatusLocked()
		a.mu.Unlock()
		return status, nil
	}
	a.syncing = true
	a.syncErr = ""
	a.mu.Unlock()
	a.emitSync()

	snapshot, err := spotify.FetchLibrary(spDc, spKey, func(progress spotify.LibraryProgress) {
		a.mu.Lock()
		if a.epoch != epoch || a.spDc != spDc {
			a.mu.Unlock()
			return
		}
		a.likedSongs = progress.LikedSongs
		a.playlistsN = progress.PlaylistsLoaded
		a.playlistTot = progress.PlaylistTotalEst
		profileChanged := false
		if name := strings.TrimSpace(progress.DisplayName); name != "" && a.displayName != name {
			a.displayName = name
			profileChanged = true
		}
		if image := strings.TrimSpace(progress.ImageURL); image != "" && a.imageURL != image {
			a.imageURL = image
			profileChanged = true
		}
		a.mu.Unlock()
		a.emitSync()
		if profileChanged {
			if err := a.persist(); err != nil {
				log.Printf("spotify account could not be saved: %v", err)
			}
			_ = SpotifyAccountChanged.Broadcast(true)
		}
	})

	a.mu.Lock()
	if a.epoch != epoch || a.spDc != spDc {
		a.mu.Unlock()
		return SpotifySyncStatus{}, errors.New("Spotify session changed")
	}
	a.syncing = false
	if err != nil {
		a.syncErr = err.Error()
		status := a.syncStatusLocked()
		a.mu.Unlock()
		a.emitSync()
		return status, err
	}
	lib := mapLibrarySnapshot(snapshot)
	a.library = &lib
	a.displayName = lib.DisplayName
	a.imageURL = lib.ImageURL
	a.likedSongs = lib.LikedSongs
	a.playlistsN = lib.PlaylistCount
	a.playlistTot = lib.PlaylistCount
	a.syncErr = ""
	status := a.syncStatusLocked()
	a.mu.Unlock()

	if err := a.persist(); err != nil {
		log.Printf("spotify library could not be saved: %v", err)
	}
	a.emitSync()
	_ = SpotifyAccountChanged.Broadcast(true)
	return status, nil
}

func (a *SpotifyAccount) Disconnect() error {
	a.disconnect("", 0)
	return nil
}

func (a *SpotifyAccount) DisconnectIf(spDc string, epoch uint64) bool {
	return a.disconnect(strings.TrimSpace(spDc), epoch)
}

func (a *SpotifyAccount) disconnect(expectedSpDc string, expectedEpoch uint64) bool {
	a.storageMu.Lock()
	defer a.storageMu.Unlock()
	a.mu.Lock()
	if expectedSpDc != "" && (a.spDc != expectedSpDc || a.epoch != expectedEpoch) {
		a.mu.Unlock()
		return false
	}
	a.epoch++
	a.spDc = ""
	a.spKey = ""
	a.displayName = ""
	a.imageURL = ""
	a.library = nil
	a.syncing = false
	a.syncErr = ""
	a.playlistsN = 0
	a.playlistTot = 0
	a.likedSongs = 0
	a.importing = false
	a.importErr = ""
	a.importSource = ""
	a.importDone = 0
	a.importTotal = 0
	a.importMatched = 0
	path := a.path
	a.mu.Unlock()
	if path != "" {
		_ = os.Remove(path)
	}
	_ = SpotifyAccountChanged.Broadcast(false)
	a.emitSync()
	return true
}

func (a *SpotifyAccount) emitSync() {
	_ = SpotifyLibrarySyncChanged.Broadcast(a.SyncStatus())
}

func (a *SpotifyAccount) syncStatusLocked() SpotifySyncStatus {
	phase := "idle"
	label := ""
	switch {
	case a.syncing:
		phase = "syncing"
		label = "Bringing your music over"
	case a.syncErr != "":
		phase = "error"
		label = a.syncErr
	case a.library != nil:
		phase = "ready"
		label = "Library ready"
	case strings.TrimSpace(a.spDc) != "":
		phase = "idle"
		label = "Linked"
	}
	var library *SpotifyLibrarySnapshot
	if a.library != nil {
		copy := *a.library
		if copy.Playlists == nil {
			copy.Playlists = []SpotifyLibraryPlaylist{}
		}
		library = &copy
	}
	return SpotifySyncStatus{
		Phase:           phase,
		Label:           label,
		DisplayName:     a.displayName,
		ImageURL:        a.imageURL,
		PlaylistsLoaded: a.playlistsN,
		PlaylistTotal:   a.playlistTot,
		LikedSongs:      a.likedSongs,
		Error:           a.syncErr,
		Library:         library,
	}
}

func mapLibrarySnapshot(snapshot spotify.LibrarySnapshot) SpotifyLibrarySnapshot {
	playlists := make([]SpotifyLibraryPlaylist, 0, len(snapshot.Playlists))
	for _, item := range snapshot.Playlists {
		playlists = append(playlists, SpotifyLibraryPlaylist{
			ID:         item.ID,
			Name:       item.Name,
			Owner:      item.Owner,
			ImageURL:   item.ImageURL,
			TrackCount: item.TrackCount,
		})
	}
	return SpotifyLibrarySnapshot{
		DisplayName:   snapshot.Profile.DisplayName,
		UserID:        snapshot.Profile.ID,
		Email:         snapshot.Profile.Email,
		ImageURL:      snapshot.Profile.ImageURL,
		Product:       snapshot.Profile.Product,
		Country:       snapshot.Profile.Country,
		LikedSongs:    snapshot.LikedSongs,
		PlaylistCount: snapshot.PlaylistCount,
		Playlists:     playlists,
	}
}

func (a *SpotifyAccount) load() error {
	if a.path == "" {
		return nil
	}
	data, err := os.ReadFile(a.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var payload spotifyAccountFile
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	spDc, spKey, migrated, err := decodeSpotifySecrets(payload)
	if err != nil {
		return err
	}
	a.mu.Lock()
	a.spDc = spDc
	a.spKey = spKey
	a.displayName = strings.TrimSpace(payload.DisplayName)
	a.imageURL = strings.TrimSpace(payload.ImageURL)
	a.library = payload.Library
	if a.library != nil {
		a.likedSongs = a.library.LikedSongs
		a.playlistsN = a.library.PlaylistCount
		a.playlistTot = a.library.PlaylistCount
		if a.displayName == "" {
			a.displayName = a.library.DisplayName
		}
		if a.imageURL == "" {
			a.imageURL = a.library.ImageURL
		}
	}
	a.mu.Unlock()
	if migrated && strings.TrimSpace(spDc) != "" {
		if err := a.persist(); err != nil {
			log.Printf("spotify account could not be re-encrypted: %v", err)
		}
	}
	return nil
}

func (a *SpotifyAccount) persist() error {
	a.storageMu.Lock()
	defer a.storageMu.Unlock()
	a.mu.Lock()
	payload := spotifyAccountFile{
		Version:     spotifyAccountFileVersion,
		DisplayName: a.displayName,
		ImageURL:    a.imageURL,
		Library:     a.library,
	}
	spDc := a.spDc
	spKey := a.spKey
	path := a.path
	a.mu.Unlock()

	protectedDc, err := protectSecret(spDc)
	if err != nil {
		return err
	}
	protectedKey, err := protectSecret(spKey)
	if err != nil {
		return err
	}
	payload.SpDcProtected = protectedDc
	payload.SpKeyProtected = protectedKey
	return writeSpotifyAccount(path, payload)
}

func decodeSpotifySecrets(payload spotifyAccountFile) (spDc, spKey string, migrated bool, err error) {
	if payload.SpDcProtected != "" {
		spDc, err = unprotectSecret(payload.SpDcProtected)
		if err != nil {
			return "", "", false, err
		}
	} else if payload.SpDc != "" {
		spDc = strings.TrimSpace(payload.SpDc)
		migrated = true
	}
	if payload.SpKeyProtected != "" {
		spKey, err = unprotectSecret(payload.SpKeyProtected)
		if err != nil {
			return "", "", false, err
		}
	} else if payload.SpKey != "" {
		spKey = strings.TrimSpace(payload.SpKey)
		migrated = true
	}
	return strings.TrimSpace(spDc), strings.TrimSpace(spKey), migrated, nil
}

func protectSecret(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	protected, err := secret.Protect([]byte(value))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(protected), nil
}

func unprotectSecret(encoded string) (string, error) {
	encoded = strings.TrimSpace(encoded)
	if encoded == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	plain, err := secret.Unprotect(raw)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func writeSpotifyAccount(path string, payload spotifyAccountFile) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("spotify account storage unavailable")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := secret.RestrictPath(path); err != nil {
		log.Printf("spotify account ACL could not be restricted: %v", err)
	}
	return nil
}
