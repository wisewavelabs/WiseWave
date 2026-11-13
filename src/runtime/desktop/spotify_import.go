package desktop

import (
	"errors"
	"strings"
	"sync"

	"github.com/egoist/mygo"
	"wisewave-runtime/internal/external/spotify"
	"wisewave-runtime/internal/models"
)

var SpotifyImportChanged = mygo.NewEvent[SpotifyImportStatus]("spotify-import-changed")

const (
	spotifyImportWorkers = 3
)

type SpotifyImportStatus struct {
	Phase     string `json:"phase"`
	SourceID  string `json:"source_id"`
	Title     string `json:"title"`
	Done      int    `json:"done"`
	Total     int    `json:"total"`
	Matched   int    `json:"matched"`
	Error     string `json:"error"`
}

type SpotifyImportResult struct {
	SourceID  string         `json:"source_id"`
	Title     string         `json:"title"`
	CoverURL  string         `json:"cover_url"`
	Liked     bool           `json:"liked"`
	Tracks    []models.Track `json:"tracks"`
	Matched   int            `json:"matched"`
	Failed    int            `json:"failed"`
	Total     int            `json:"total"`
}

type trackSearcher func(query string) ([]models.Track, error)

func WireSpotifySearch(a *SpotifyAccount, search trackSearcher) {
	if a == nil {
		return
	}
	a.mu.Lock()
	a.search = search
	a.mu.Unlock()
}

func (a *SpotifyAccount) ImportStatus() SpotifyImportStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.importStatusLocked()
}

func (a *SpotifyAccount) Import(sourceID string) (SpotifyImportResult, error) {
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" {
		return SpotifyImportResult{}, errors.New("Nothing to import")
	}

	a.mu.Lock()
	if a.importing {
		a.mu.Unlock()
		return SpotifyImportResult{}, errors.New("An import is already running")
	}
	spDc := a.spDc
	spKey := a.spKey
	search := a.search
	library := a.library
	a.importing = true
	a.importErr = ""
	a.importSource = sourceID
	a.importDone = 0
	a.importTotal = 0
	a.importMatched = 0
	a.mu.Unlock()
	a.emitImport()

	defer func() {
		a.mu.Lock()
		a.importing = false
		a.mu.Unlock()
		a.emitImport()
	}()

	if strings.TrimSpace(spDc) == "" {
		return a.failImport(errors.New("Spotify is not linked"))
	}
	if search == nil {
		return a.failImport(errors.New("Search is unavailable"))
	}

	liked := sourceID == "liked"
	title := "Playlist"
	cover := ""
	var (
		sourceTracks []spotify.SourceTrack
		err          error
	)
	if liked {
		title = "Liked Songs"
		sourceTracks, err = spotify.FetchLikedTracks(spDc, spKey, func(loaded, total int) {
			a.mu.Lock()
			a.importTotal = total
			a.importDone = loaded
			a.mu.Unlock()
			a.emitImport()
		})
	} else {
		if library != nil {
			for _, playlist := range library.Playlists {
				if playlist.ID == sourceID {
					title = playlist.Name
					cover = playlist.ImageURL
					break
				}
			}
		}
		sourceTracks, err = spotify.FetchPlaylistTracks(spDc, spKey, sourceID, func(loaded, total int) {
			a.mu.Lock()
			a.importTotal = total
			a.importDone = loaded
			a.mu.Unlock()
			a.emitImport()
		})
	}
	if err != nil {
		return a.failImport(err)
	}

	a.mu.Lock()
	a.importTotal = len(sourceTracks)
	a.importDone = 0
	a.importMatched = 0
	a.mu.Unlock()
	a.emitImport()

	matched := matchSourceTracks(sourceTracks, search, func(done, total, hits int) {
		a.mu.Lock()
		a.importDone = done
		a.importTotal = total
		a.importMatched = hits
		a.mu.Unlock()
		a.emitImport()
	})

	result := SpotifyImportResult{
		SourceID: sourceID,
		Title:    title,
		CoverURL: cover,
		Liked:    liked,
		Tracks:   matched,
		Matched:  len(matched),
		Failed:   len(sourceTracks) - len(matched),
		Total:    len(sourceTracks),
	}
	a.mu.Lock()
	a.importErr = ""
	a.importDone = len(sourceTracks)
	a.importMatched = len(matched)
	a.mu.Unlock()
	a.emitImport()
	return result, nil
}

func (a *SpotifyAccount) failImport(err error) (SpotifyImportResult, error) {
	a.mu.Lock()
	a.importErr = err.Error()
	a.mu.Unlock()
	a.emitImport()
	return SpotifyImportResult{}, err
}

func (a *SpotifyAccount) emitImport() {
	_ = SpotifyImportChanged.Broadcast(a.ImportStatus())
}

func (a *SpotifyAccount) importStatusLocked() SpotifyImportStatus {
	phase := "idle"
	switch {
	case a.importing:
		phase = "importing"
	case a.importErr != "":
		phase = "error"
	}
	return SpotifyImportStatus{
		Phase:    phase,
		SourceID: a.importSource,
		Title:    a.importSource,
		Done:     a.importDone,
		Total:    a.importTotal,
		Matched:  a.importMatched,
		Error:    a.importErr,
	}
}

func matchSourceTracks(source []spotify.SourceTrack, search trackSearcher, onProgress func(done, total, matched int)) []models.Track {
	if len(source) == 0 {
		return nil
	}
	type slot struct {
		index int
		track models.Track
		ok    bool
	}
	out := make([]slot, len(source))
	jobs := make(chan int, len(source))
	for i := range source {
		jobs <- i
	}
	close(jobs)

	var mu sync.Mutex
	done := 0
	hits := 0
	workers := spotifyImportWorkers
	if workers > len(source) {
		workers = len(source)
	}
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				item := source[index]
				track, ok := matchOneTrack(item, search)
				mu.Lock()
				out[index] = slot{index: index, track: track, ok: ok}
				done++
				if ok {
					hits++
				}
				currentDone, currentHits := done, hits
				mu.Unlock()
				if onProgress != nil {
					onProgress(currentDone, len(source), currentHits)
				}
			}
		}()
	}
	wg.Wait()

	matched := make([]models.Track, 0, len(source))
	for _, item := range out {
		if item.ok {
			matched = append(matched, item.track)
		}
	}
	return matched
}

func matchOneTrack(item spotify.SourceTrack, search trackSearcher) (models.Track, bool) {
	query := spotify.BuildSearchQuery(item)
	if query == "" {
		return models.Track{}, false
	}
	candidates, err := search(query)
	if err != nil || len(candidates) == 0 {
		return models.Track{}, false
	}
	bestScore := -1.0
	best := models.Track{}
	for _, candidate := range candidates {
		score := spotify.MatchScore(item.Title, item.Artist, item.DurationMs, candidate.Title, candidate.Artist, candidate.DurationSeconds)
		if score > bestScore {
			bestScore = score
			best = candidate
		}
	}
	if bestScore <= 0 || strings.TrimSpace(best.ID) == "" {
		return models.Track{}, false
	}
	return best, true
}
