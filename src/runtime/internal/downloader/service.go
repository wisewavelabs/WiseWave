package downloader

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"wisewave-runtime/internal/cache"
	"wisewave-runtime/internal/external/gaana"
	"wisewave-runtime/internal/external/jiosaavn"
	"wisewave-runtime/internal/innertube"
	"wisewave-runtime/internal/lyrics"
	"wisewave-runtime/internal/storage"
)

type DownloadResult struct {
	TrackID         string `json:"track_id"`
	Title           string `json:"title"`
	Artist          string `json:"artist"`
	Album           string `json:"album"`
	AudioFilePath   string `json:"audio_file_path"`
	LyricsFilePath  string `json:"lyrics_file_path,omitempty"`
	TtmlFilePath    string `json:"ttml_file_path,omitempty"`
	FileSizeBytes   int64  `json:"file_size_bytes"`
	HasSyncedLrc    bool   `json:"has_synced_lrc"`
	HasTtmlSyllable bool   `json:"has_ttml_syllable"`
}

type OfflineTrack struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	Artist         string `json:"artist"`
	Album          string `json:"album"`
	AudioFileName  string `json:"audio_file_name"`
	AudioFilePath  string `json:"audio_file_path"`
	LyricsFilePath string `json:"lyrics_file_path,omitempty"`
	TtmlFilePath   string `json:"ttml_file_path,omitempty"`
	FileSizeBytes  int64  `json:"file_size_bytes"`
	HasLyrics      bool   `json:"has_lyrics"`
	HasTtml        bool   `json:"has_ttml"`
	ModifiedAt     int64  `json:"modified_at"`
}

type Service struct {
	catalog       *storage.Catalog
	mediaDir      string
	offlineDir    string
	tube          *innertube.Client
	saavn         *jiosaavn.Client
	gaana         *gaana.Client
	lyricsService *lyrics.Service
	streamCache   *cache.StreamCache
	httpClient    *http.Client
	trackLocks    sync.Map
}

func NewService(
	catalog *storage.Catalog,
	mediaDir string,
	tube *innertube.Client,
	saavn *jiosaavn.Client,
	gaana *gaana.Client,
	lyricsService *lyrics.Service,
	streamCache *cache.StreamCache,
) *Service {
	offlineDir := filepath.Join(mediaDir, "offline")
	_ = os.MkdirAll(offlineDir, 0755)

	return &Service{
		catalog:       catalog,
		mediaDir:      mediaDir,
		offlineDir:    offlineDir,
		tube:          tube,
		saavn:         saavn,
		gaana:         gaana,
		lyricsService: lyricsService,
		streamCache:   streamCache,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (s *Service) lockTrack(trackID string) func() {
	val, _ := s.trackLocks.LoadOrStore(trackID, &sync.Mutex{})
	mu := val.(*sync.Mutex)
	mu.Lock()
	return func() {
		mu.Unlock()
	}
}

func (s *Service) resolveStreamURL(trackID, title, artist string) (string, error) {
	if cached, hit := s.streamCache.Get(trackID); hit && cached.URL != "" {
		return cached.URL, nil
	}

	if strings.HasPrefix(trackID, "saavn:") || strings.HasPrefix(trackID, "jiosaavn:") {
		res, err := s.saavn.ResolveAudioStream(trackID)
		if err == nil && res != nil {
			s.streamCache.Put(trackID, *res)
			return res.URL, nil
		}
	}

	if strings.HasPrefix(trackID, "gaana:") {
		res, err := s.gaana.ResolveAudioStream(trackID)
		if err == nil && res != nil {
			s.streamCache.Put(trackID, *res)
			return res.URL, nil
		}
	}

	if !strings.HasPrefix(trackID, "spotify:") {
		res, err := s.tube.ResolveAudioStream(trackID)
		if err == nil && res != nil {
			s.streamCache.Put(trackID, *res)
			return res.URL, nil
		}
	}

	searchQuery := strings.TrimSpace(title + " " + artist)
	if searchQuery == "" {
		searchQuery = trackID
	}

	if saavnTracks, errSaavn := s.saavn.Search(searchQuery); errSaavn == nil && len(saavnTracks) > 0 {
		if saavnStream, errRes := s.saavn.ResolveAudioStream(saavnTracks[0].ID); errRes == nil && saavnStream != nil {
			s.streamCache.Put(trackID, *saavnStream)
			return saavnStream.URL, nil
		}
	}

	if gaanaTracks, errGaana := s.gaana.Search(searchQuery); errGaana == nil && len(gaanaTracks) > 0 {
		if gaanaStream, errRes := s.gaana.ResolveAudioStream(gaanaTracks[0].ID); errRes == nil && gaanaStream != nil {
			s.streamCache.Put(trackID, *gaanaStream)
			return gaanaStream.URL, nil
		}
	}

	return "", fmt.Errorf("unable to resolve audio stream for offline download")
}

func sanitizeFileName(name string) string {
	invalidChars := regexp.MustCompile(`[\\/:*?"<>|]`)
	clean := invalidChars.ReplaceAllString(name, "_")
	clean = strings.TrimSpace(clean)
	if clean == "" {
		return "Track"
	}
	return clean
}

func detectAudioExtension(contentType string, leading []byte) string {
	ct := strings.ToLower(contentType)
	if strings.Contains(ct, "audio/mpeg") || strings.Contains(ct, "audio/mp3") {
		return ".mp3"
	}
	if strings.Contains(ct, "audio/flac") {
		return ".flac"
	}
	if strings.Contains(ct, "audio/wav") || strings.Contains(ct, "audio/x-wav") {
		return ".wav"
	}
	if strings.Contains(ct, "audio/ogg") || strings.Contains(ct, "application/ogg") {
		return ".ogg"
	}
	if strings.Contains(ct, "audio/webm") || strings.Contains(ct, "video/webm") {
		return ".webm"
	}
	if strings.Contains(ct, "audio/mp4") || strings.Contains(ct, "audio/m4a") || strings.Contains(ct, "audio/aac") {
		return ".m4a"
	}

	if len(leading) >= 4 {
		if string(leading[:3]) == "ID3" || (leading[0] == 0xFF && (leading[1]&0xE0) == 0xE0) {
			return ".mp3"
		}
		if string(leading[:4]) == "fLaC" {
			return ".flac"
		}
		if string(leading[:4]) == "OggS" {
			return ".ogg"
		}
		if len(leading) >= 8 && string(leading[4:8]) == "ftyp" {
			return ".m4a"
		}
		if leading[0] == 0x1A && leading[1] == 0x45 && leading[2] == 0xDF && leading[3] == 0xA3 {
			return ".webm"
		}
	}

	return ".m4a"
}

func (s *Service) DownloadTrack(trackID, title, artist, album string, durationSec int) (*DownloadResult, error) {
	if strings.TrimSpace(trackID) == "" {
		return nil, fmt.Errorf("track_id is required")
	}

	unlock := s.lockTrack(trackID)
	defer unlock()

	if strings.TrimSpace(title) == "" {
		title = "Unknown Title"
	}
	if strings.TrimSpace(artist) == "" {
		artist = "Unknown Artist"
	}
	if strings.TrimSpace(album) == "" {
		album = "WiseWave Offline"
	}

	streamURL, err := s.resolveStreamURL(trackID, title, artist)
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(s.offlineDir, 0755); err != nil {
		return nil, fmt.Errorf("cannot create offline directory: %w", err)
	}

	cleanArtist := sanitizeFileName(artist)
	cleanTitle := sanitizeFileName(title)
	cleanID := sanitizeFileName(trackID)
	baseName := fmt.Sprintf("%s - %s [%s]", cleanArtist, cleanTitle, cleanID)

	req, err := http.NewRequest("GET", streamURL, nil)
	if err != nil {
		return nil, fmt.Errorf("cannot prepare stream request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("audio stream request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return nil, fmt.Errorf("audio stream source returned HTTP %d", resp.StatusCode)
	}

	peekBuf := make([]byte, 512)
	n, _ := io.ReadFull(resp.Body, peekBuf)
	leadingBytes := peekBuf[:n]
	ext := detectAudioExtension(resp.Header.Get("Content-Type"), leadingBytes)

	audioFileName := baseName + ext
	audioFilePath := filepath.Join(s.offlineDir, audioFileName)
	tempAudioFilePath := filepath.Join(s.offlineDir, fmt.Sprintf(".tmp_%s_%d%s", cleanID, time.Now().UnixNano(), ext))

	outFile, err := os.Create(tempAudioFilePath)
	if err != nil {
		return nil, fmt.Errorf("cannot create temporary audio file: %w", err)
	}

	var copiedBytes int64
	if n > 0 {
		written, err := outFile.Write(leadingBytes)
		if err != nil {
			outFile.Close()
			_ = os.Remove(tempAudioFilePath)
			return nil, fmt.Errorf("failed to write initial audio buffer: %w", err)
		}
		copiedBytes += int64(written)
	}

	restCopied, err := io.Copy(outFile, resp.Body)
	outFile.Close()
	if err != nil {
		_ = os.Remove(tempAudioFilePath)
		return nil, fmt.Errorf("audio download interrupted: %w", err)
	}
	copiedBytes += restCopied

	if copiedBytes < 1024 {
		_ = os.Remove(tempAudioFilePath)
		return nil, fmt.Errorf("downloaded audio file too small or incomplete (%d bytes)", copiedBytes)
	}

	if err := os.Rename(tempAudioFilePath, audioFilePath); err != nil {
		_ = os.Remove(tempAudioFilePath)
		return nil, fmt.Errorf("failed to finalize audio file: %w", err)
	}

	result := &DownloadResult{
		TrackID:       trackID,
		Title:         title,
		Artist:        artist,
		Album:         album,
		AudioFilePath: audioFilePath,
		FileSizeBytes: copiedBytes,
	}

	meta := lyrics.TrackMeta{
		Title:           title,
		Artist:          artist,
		Album:           album,
		DurationSeconds: durationSec,
		DurationMs:      int64(durationSec * 1000),
	}

	doc, errLyrics := s.lyricsService.FetchDocument(meta)
	if errLyrics == nil && doc != nil {
		lrcContent := doc.SyncedLyrics
		if strings.TrimSpace(lrcContent) == "" && len(doc.Lines) > 0 {
			lrcContent = lyrics.BuildSyncedLrc(doc.Lines)
		}
		if strings.TrimSpace(lrcContent) == "" && strings.TrimSpace(doc.PlainLyrics) != "" {
			lrcContent = doc.PlainLyrics
		}

		if strings.TrimSpace(lrcContent) != "" {
			lrcFileName := baseName + ".lrc"
			lrcFilePath := filepath.Join(s.offlineDir, lrcFileName)
			tempLrcPath := filepath.Join(s.offlineDir, fmt.Sprintf(".tmp_%s_%d.lrc", cleanID, time.Now().UnixNano()))
			if errW := os.WriteFile(tempLrcPath, []byte(lrcContent), 0644); errW == nil {
				if errRen := os.Rename(tempLrcPath, lrcFilePath); errRen == nil {
					result.LyricsFilePath = lrcFilePath
					result.HasSyncedLrc = doc.SyncedLyrics != "" || len(doc.Lines) > 0
				} else {
					_ = os.Remove(tempLrcPath)
				}
			}
		}

		if doc.Type == "syllable" || len(doc.Lines) > 0 {
			ttmlContent := lyrics.GenerateTtml(title, artist, doc.Lines)
			if strings.TrimSpace(ttmlContent) != "" {
				ttmlFileName := baseName + ".ttml"
				ttmlFilePath := filepath.Join(s.offlineDir, ttmlFileName)
				tempTtmlPath := filepath.Join(s.offlineDir, fmt.Sprintf(".tmp_%s_%d.ttml", cleanID, time.Now().UnixNano()))
				if errT := os.WriteFile(tempTtmlPath, []byte(ttmlContent), 0644); errT == nil {
					if errRen := os.Rename(tempTtmlPath, ttmlFilePath); errRen == nil {
						result.TtmlFilePath = ttmlFilePath
						result.HasTtmlSyllable = true
					} else {
						_ = os.Remove(tempTtmlPath)
					}
				}
			}
		}
	}

	s.catalog.Rescan()

	return result, nil
}

func (s *Service) ListOfflineTracks() ([]OfflineTrack, error) {
	entries, err := os.ReadDir(s.offlineDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []OfflineTrack{}, nil
		}
		return nil, err
	}

	var tracks []OfflineTrack
	audioExts := map[string]bool{
		".m4a":  true,
		".mp3":  true,
		".flac": true,
		".wav":  true,
		".ogg":  true,
		".aac":  true,
		".webm": true,
		".opus": true,
	}

	idExtractRegex := regexp.MustCompile(`\[([A-Za-z0-9_-]+)\]$`)

	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".tmp_") {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if !audioExts[ext] {
			continue
		}

		baseName := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		fullAudioPath := filepath.Join(s.offlineDir, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}

		title := baseName
		artist := "Unknown Artist"
		trackID := baseName

		if match := idExtractRegex.FindStringSubmatch(baseName); len(match) == 2 {
			trackID = match[1]
			cleanBase := strings.TrimSpace(strings.TrimSuffix(baseName, match[0]))
			if parts := strings.SplitN(cleanBase, " - ", 2); len(parts) == 2 {
				artist = strings.TrimSpace(parts[0])
				title = strings.TrimSpace(parts[1])
			} else {
				title = cleanBase
			}
		} else if parts := strings.SplitN(baseName, " - ", 2); len(parts) == 2 {
			artist = strings.TrimSpace(parts[0])
			title = strings.TrimSpace(parts[1])
		}

		lrcPath := filepath.Join(s.offlineDir, baseName+".lrc")
		hasLyrics := false
		if _, err := os.Stat(lrcPath); err == nil {
			hasLyrics = true
		} else {
			lrcPath = ""
		}

		ttmlPath := filepath.Join(s.offlineDir, baseName+".ttml")
		hasTtml := false
		if _, err := os.Stat(ttmlPath); err == nil {
			hasTtml = true
		} else {
			ttmlPath = ""
		}

		tracks = append(tracks, OfflineTrack{
			ID:             trackID,
			Title:          title,
			Artist:         artist,
			Album:          "WiseWave Offline",
			AudioFileName:  entry.Name(),
			AudioFilePath:  fullAudioPath,
			LyricsFilePath: lrcPath,
			TtmlFilePath:   ttmlPath,
			FileSizeBytes:  info.Size(),
			HasLyrics:      hasLyrics,
			HasTtml:        hasTtml,
			ModifiedAt:     info.ModTime().UnixMilli(),
		})
	}

	return tracks, nil
}

func (s *Service) GetOfflineAudioFile(trackID string) (string, string, error) {
	tracks, err := s.ListOfflineTracks()
	if err != nil {
		return "", "", err
	}

	cleanID := strings.TrimSpace(trackID)
	for _, t := range tracks {
		if t.ID == cleanID || strings.EqualFold(t.AudioFileName, cleanID) || strings.Contains(t.AudioFileName, "["+cleanID+"]") {
			return t.AudioFilePath, t.AudioFileName, nil
		}
	}

	return "", "", fmt.Errorf("offline audio file not found")
}

func (s *Service) GetOfflineLyricsFile(trackID string) (string, string, error) {
	tracks, err := s.ListOfflineTracks()
	if err != nil {
		return "", "", err
	}

	cleanID := strings.TrimSpace(trackID)
	for _, t := range tracks {
		if t.ID == cleanID || strings.EqualFold(t.AudioFileName, cleanID) || strings.Contains(t.AudioFileName, "["+cleanID+"]") {
			if t.LyricsFilePath != "" {
				return t.LyricsFilePath, filepath.Base(t.LyricsFilePath), nil
			}
			return "", "", fmt.Errorf("no lyrics file found for this track")
		}
	}

	return "", "", fmt.Errorf("track not found")
}

func (s *Service) StreamZipBundle(trackID string, w io.Writer) (string, error) {
	tracks, err := s.ListOfflineTracks()
	if err != nil {
		return "", err
	}

	var matched *OfflineTrack
	for _, t := range tracks {
		if t.ID == trackID || strings.EqualFold(t.AudioFileName, trackID) {
			matched = &t
			break
		}
	}

	if matched == nil {
		return "", fmt.Errorf("track not found in offline library")
	}

	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()

	audioFile, err := os.Open(matched.AudioFilePath)
	if err != nil {
		return "", fmt.Errorf("cannot open audio file: %w", err)
	}
	defer audioFile.Close()

	audioZipEntry, err := zipWriter.Create(matched.AudioFileName)
	if err != nil {
		return "", fmt.Errorf("cannot create zip audio entry: %w", err)
	}
	if _, err := io.Copy(audioZipEntry, audioFile); err != nil {
		return "", fmt.Errorf("cannot write audio into zip: %w", err)
	}

	if matched.LyricsFilePath != "" {
		if lrcFile, err := os.Open(matched.LyricsFilePath); err == nil {
			defer lrcFile.Close()
			if lrcZipEntry, err := zipWriter.Create(filepath.Base(matched.LyricsFilePath)); err == nil {
				_, _ = io.Copy(lrcZipEntry, lrcFile)
			}
		}
	}

	if matched.TtmlFilePath != "" {
		if ttmlFile, err := os.Open(matched.TtmlFilePath); err == nil {
			defer ttmlFile.Close()
			if ttmlZipEntry, err := zipWriter.Create(filepath.Base(matched.TtmlFilePath)); err == nil {
				_, _ = io.Copy(ttmlZipEntry, ttmlFile)
			}
		}
	}

	bundleFileName := matched.ID + ".zip"
	return bundleFileName, nil
}
