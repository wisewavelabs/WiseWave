package youtube

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"wisewave-runtime/internal/innertube"
	"wisewave-runtime/internal/models"
)

var YouTubeLibrarySyncChanged = mygo.NewEvent[YouTubeSyncStatus]("youtube-library-sync-changed")
var youtubeCollectionID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,160}$`)
var youtubePlaylistTrackCount = regexp.MustCompile(`(?i)([0-9][0-9,]*)\s+(?:songs?|tracks?|videos?)\b`)
var YouTubeImportChanged = mygo.NewEvent[YouTubeImportStatus]("youtube-import-changed")

type YouTubeImportStatus struct {
	Phase    string `json:"phase"`
	Stage    string `json:"stage"`
	SourceID string `json:"source_id"`
	Done     int    `json:"done"`
	Total    int    `json:"total"`
	Matched  int    `json:"matched"`
	Error    string `json:"error"`
}

func (a *YouTubeAccount) ImportStatus() YouTubeImportStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.importStatus
}

type YouTubeLibraryPlaylist struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Subtitle   string `json:"subtitle"`
	Owner      string `json:"owner"`
	TrackCount int    `json:"track_count"`
	ImageURL   string `json:"image_url"`
}

type YouTubeLibrarySnapshot struct {
	DisplayName   string                   `json:"display_name"`
	Username      string                   `json:"username"`
	ImageURL      string                   `json:"image_url"`
	Email         string                   `json:"email"`
	LikedSongs    int                      `json:"liked_songs"`
	PlaylistCount int                      `json:"playlist_count"`
	Playlists     []YouTubeLibraryPlaylist `json:"playlists"`
}

type YouTubeSyncStatus struct {
	Phase   string                  `json:"phase"`
	Error   string                  `json:"error"`
	Library *YouTubeLibrarySnapshot `json:"library"`
}

type YouTubeImportResult struct {
	SourceID string         `json:"source_id"`
	Title    string         `json:"title"`
	CoverURL string         `json:"cover_url"`
	Liked    bool           `json:"liked"`
	Tracks   []models.Track `json:"tracks"`
	Matched  int            `json:"matched"`
	Failed   int            `json:"failed"`
	Total    int            `json:"total"`
}

func (a *YouTubeAccount) SyncStatus() YouTubeSyncStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.syncStatusLocked()
}

func (a *YouTubeAccount) syncStatusLocked() YouTubeSyncStatus {
	phase := "idle"
	if a.syncing {
		phase = "syncing"
	} else if a.syncError != "" {
		phase = "error"
	} else if a.library != nil {
		phase = "ready"
	}
	var snapshot *YouTubeLibrarySnapshot
	if a.library != nil {
		copy := *a.library
		copy.Playlists = append([]YouTubeLibraryPlaylist{}, copy.Playlists...)
		snapshot = &copy
	}
	return YouTubeSyncStatus{phase, a.syncError, snapshot}
}

func (a *YouTubeAccount) SyncLibrary() (YouTubeSyncStatus, error) {
	a.mu.Lock()
	if !a.status.Linked || a.auth == nil {
		a.mu.Unlock()
		return YouTubeSyncStatus{}, errors.New("Connect YouTube first")
	}
	if a.syncing {
		status := a.syncStatusLocked()
		a.mu.Unlock()
		return status, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	a.syncCancel = cancel
	a.syncing = true
	a.syncError = ""
	a.syncID++
	epoch, syncID := a.epoch, a.syncID
	client := innertube.NewMusicClient(innertube.MusicOptions{CookieAuth: a.auth})
	identity := a.status
	status := a.syncStatusLocked()
	a.mu.Unlock()
	_ = YouTubeLibrarySyncChanged.Broadcast(status)
	go func() {
		defer cancel()
		result, err := client.StreamLibrary(ctx, nil)
		snapshot := &YouTubeLibrarySnapshot{DisplayName: identity.DisplayName, Username: identity.Username, Email: identity.Email, ImageURL: identity.ImageURL, Playlists: []YouTubeLibraryPlaylist{}}
		if err == nil {
			seen := map[string]bool{}
			add := func(items []innertube.MusicItem) {
				for _, item := range items {
					target := item.Target()
					id := strings.TrimPrefix(target.ID, "VL")
					if target.Kind != innertube.TargetPlaylist || id == "LM" || id == "" || seen[id] {
						continue
					}
					seen[id] = true
					trackCount := 0
					if match := youtubePlaylistTrackCount.FindStringSubmatch(item.Subtitle); len(match) > 1 {
						trackCount, _ = strconv.Atoi(strings.ReplaceAll(match[1], ",", ""))
					}
					snapshot.Playlists = append(snapshot.Playlists, YouTubeLibraryPlaylist{ID: id, Name: item.Title, Subtitle: item.Subtitle, Owner: item.Owner, TrackCount: trackCount, ImageURL: item.Thumbnail})
				}
			}
			add(result.Items)
			for _, section := range result.Sections {
				add(section.Items)
			}
			snapshot.PlaylistCount = len(snapshot.Playlists)
			liked, likedErr := readYouTubeCollection(ctx, client, "LM")
			if likedErr != nil {
				err = likedErr
			} else {
				snapshot.LikedSongs = len(liked)
			}
		}
		a.mu.Lock()
		if a.epoch != epoch || a.syncID != syncID {
			a.mu.Unlock()
			return
		}
		a.syncing = false
		a.syncCancel = nil
		if err != nil {
			a.syncError = "Could not load your YouTube library. Please try again."
		} else {
			a.library = snapshot
		}
		status := a.syncStatusLocked()
		a.mu.Unlock()
		_ = YouTubeLibrarySyncChanged.Broadcast(status)
	}()
	return status, nil
}

func (a *YouTubeAccount) CancelSync() {
	a.mu.Lock()
	if a.syncCancel != nil {
		a.syncCancel()
		a.syncCancel = nil
	}
	a.syncID++
	a.syncing = false
	a.mu.Unlock()
	_ = YouTubeLibrarySyncChanged.Broadcast(a.SyncStatus())
}

func (a *YouTubeAccount) Import(sourceID string) (result YouTubeImportResult, resultErr error) {
	a.mu.Lock()
	if a.importing {
		a.mu.Unlock()
		return YouTubeImportResult{}, errors.New("An import is already running")
	}
	if !a.status.Linked || a.auth == nil {
		a.mu.Unlock()
		return YouTubeImportResult{}, errors.New("Connect YouTube first")
	}
	epoch := a.epoch
	auth := a.auth
	id, title, cover := "LM", "Liked music", ""
	liked := sourceID == "liked"
	total := 0
	if liked && a.library != nil {
		total = a.library.LikedSongs
	}
	if !liked {
		if a.library != nil {
			for _, playlist := range a.library.Playlists {
				if playlist.ID == sourceID {
					id, title, cover = playlist.ID, playlist.Name, playlist.ImageURL
					break
				}
			}
		}
		if id == "LM" {
			a.mu.Unlock()
			return YouTubeImportResult{}, errors.New("This playlist is not in your YouTube library")
		}
	}
	a.importing = true
	a.importStatus = YouTubeImportStatus{Phase: "importing", Stage: "reading", SourceID: sourceID, Total: total}
	initial := a.importStatus
	a.mu.Unlock()
	_ = YouTubeImportChanged.Broadcast(initial)
	defer func() {
		a.mu.Lock()
		a.importing = false
		if a.epoch == epoch {
			if resultErr != nil {
				a.importStatus.Phase = "error"
				a.importStatus.Stage = "error"
				a.importStatus.Error = resultErr.Error()
			} else {
				a.importStatus.Phase = "complete"
				a.importStatus.Stage = "complete"
				a.importStatus.Done = len(result.Tracks)
				a.importStatus.Total = len(result.Tracks)
				a.importStatus.Matched = len(result.Tracks)
			}
		} else {
			a.importStatus = YouTubeImportStatus{Phase: "error", Stage: "error", SourceID: sourceID, Error: "YouTube account changed during import"}
		}
		status := a.importStatus
		a.mu.Unlock()
		_ = YouTubeImportChanged.Broadcast(status)
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	tracks, err := readYouTubeCollection(ctx, innertube.NewMusicClient(innertube.MusicOptions{CookieAuth: auth}), id, func(done int) {
		a.mu.Lock()
		if a.epoch != epoch {
			a.mu.Unlock()
			cancel()
			return
		}
		a.importStatus.Done = done
		a.importStatus.Matched = done
		status := a.importStatus
		a.mu.Unlock()
		_ = YouTubeImportChanged.Broadcast(status)
	})
	if err != nil {
		return YouTubeImportResult{}, fmt.Errorf("Could not import this YouTube collection: %w", err)
	}
	a.mu.Lock()
	valid := a.epoch == epoch && a.status.Linked
	a.mu.Unlock()
	if !valid {
		return YouTubeImportResult{}, errors.New("YouTube account changed during import")
	}
	return YouTubeImportResult{SourceID: sourceID, Title: title, CoverURL: cover, Liked: liked, Tracks: tracks, Matched: len(tracks), Total: len(tracks)}, nil
}

func readYouTubeCollection(ctx context.Context, client *innertube.MusicClient, id string, progress ...func(int)) ([]models.Track, error) {
	if !youtubeCollectionID.MatchString(id) {
		return nil, errors.New("Invalid YouTube collection")
	}
	tracks, err := client.GetPlaylistTracks(ctx, id, func(items int) {
		if len(progress) > 0 && progress[0] != nil {
			progress[0](items)
		}
	})
	if err != nil {
		return nil, err
	}
	return tracks, nil
}
