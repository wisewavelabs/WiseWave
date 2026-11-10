package storage

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"wisewave-runtime/internal/models"
)

type Catalog struct {
	mu       sync.RWMutex
	mediaDir string
	baseURL  string
	tracks   map[string]models.Track
	albums   map[string]models.Album
}

func NewCatalog(mediaDir string, baseURL string) *Catalog {
	c := &Catalog{
		mediaDir: mediaDir,
		baseURL:  baseURL,
		tracks:   make(map[string]models.Track),
		albums:   make(map[string]models.Album),
	}
	c.Rescan()
	return c
}

func (c *Catalog) Rescan() int {
	c.mu.Lock()
	defer c.mu.Unlock()

	if err := os.MkdirAll(c.mediaDir, 0755); err != nil {
		return 0
	}

	c.tracks = make(map[string]models.Track)
	c.albums = make(map[string]models.Album)

	supportedExts := map[string]bool{
		".mp3":  true,
		".flac": true,
		".wav":  true,
		".ogg":  true,
		".m4a":  true,
		".aac":  true,
	}

	_ = filepath.Walk(c.mediaDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if !supportedExts[ext] {
			return nil
		}

		relPath, _ := filepath.Rel(c.mediaDir, path)
		hasher := sha1.New()
		hasher.Write([]byte(relPath))
		trackID := hex.EncodeToString(hasher.Sum(nil))[:12]

		fileNameWithoutExt := strings.TrimSuffix(info.Name(), filepath.Ext(info.Name()))
		title := fileNameWithoutExt
		artist := "Unknown Artist"
		album := "Local Library"

		if parts := strings.SplitN(fileNameWithoutExt, " - ", 2); len(parts) == 2 {
			artist = strings.TrimSpace(parts[0])
			title = strings.TrimSpace(parts[1])
		}

		dir := filepath.Dir(relPath)
		if dir != "." && dir != "" {
			album = filepath.Base(dir)
		}

		streamURL := fmt.Sprintf("%s/api/v1/stream/%s", c.baseURL, trackID)

		track := models.Track{
			ID:              trackID,
			Title:           title,
			Artist:          artist,
			Album:           album,
			Duration:        "--:--",
			DurationSeconds: 0,
			AlbumArtURL:     "",
			StreamURL:       streamURL,
			FilePath:        path,
			IsFavorite:      false,
		}

		coverCandidates := []string{"cover.jpg", "cover.png", "folder.jpg", "folder.png"}
		parentDir := filepath.Dir(path)
		for _, coverName := range coverCandidates {
			coverPath := filepath.Join(parentDir, coverName)
			if _, err := os.Stat(coverPath); err == nil {
				track.AlbumArtURL = fmt.Sprintf("%s/api/v1/artwork/%s", c.baseURL, trackID)
				break
			}
		}

		c.tracks[trackID] = track

		albumID := "alb_" + trackID[:6]
		if _, exists := c.albums[album]; !exists {
			c.albums[album] = models.Album{
				ID:         albumID,
				Title:      album,
				Artist:     artist,
				CoverURL:   track.AlbumArtURL,
				Year:       0,
				TrackCount: 1,
				Genre:      "Local",
			}
		} else {
			a := c.albums[album]
			a.TrackCount++
			c.albums[album] = a
		}

		return nil
	})

	return len(c.tracks)
}

func (c *Catalog) GetAllTracks() []models.Track {
	c.mu.RLock()
	defer c.mu.RUnlock()

	result := make([]models.Track, 0, len(c.tracks))
	for _, t := range c.tracks {
		result = append(result, t)
	}
	return result
}

func (c *Catalog) GetTrack(id string) (models.Track, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	t, exists := c.tracks[id]
	return t, exists
}

func (c *Catalog) Search(query string) []models.Track {
	c.mu.RLock()
	defer c.mu.RUnlock()

	q := strings.ToLower(query)
	var result []models.Track
	for _, t := range c.tracks {
		if strings.Contains(strings.ToLower(t.Title), q) ||
			strings.Contains(strings.ToLower(t.Artist), q) ||
			strings.Contains(strings.ToLower(t.Album), q) {
			result = append(result, t)
		}
	}
	return result
}

func (c *Catalog) GetAllAlbums() []models.Album {
	c.mu.RLock()
	defer c.mu.RUnlock()

	result := make([]models.Album, 0, len(c.albums))
	for _, a := range c.albums {
		result = append(result, a)
	}
	return result
}
