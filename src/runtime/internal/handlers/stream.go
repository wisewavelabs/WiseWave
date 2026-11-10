package handlers

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"wisewave-runtime/internal/cache"
	"wisewave-runtime/internal/err"
	"wisewave-runtime/internal/external/gaana"
	"wisewave-runtime/internal/external/jiosaavn"
	"wisewave-runtime/internal/innertube"
	"wisewave-runtime/internal/storage"
)

var hopByHopHeaders = map[string]bool{
	"connection":          true,
	"keep-alive":          true,
	"proxy-authenticate":  true,
	"proxy-authorization": true,
	"te":                  true,
	"trailer":             true,
	"transfer-encoding":   true,
	"upgrade":             true,
}

type StreamHandler struct {
	catalog    *storage.Catalog
	mediaDir   string
	tube       *innertube.Client
	cache      *cache.StreamCache
	saavn      *jiosaavn.Client
	gaana      *gaana.Client
	httpClient *http.Client
}

func NewStreamHandler(
	catalog *storage.Catalog,
	mediaDir string,
	tube *innertube.Client,
	streamCache *cache.StreamCache,
	saavn *jiosaavn.Client,
	gaana *gaana.Client,
) *StreamHandler {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ResponseHeaderTimeout: 15 * time.Second,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	return &StreamHandler{
		catalog:    catalog,
		mediaDir:   mediaDir,
		tube:       tube,
		cache:      streamCache,
		saavn:      saavn,
		gaana:      gaana,
		httpClient: &http.Client{Transport: transport},
	}
}

func (h *StreamHandler) HandleResolve(c *fiber.Ctx) error {
	trackID := c.Params("id")

	if stream, hit := h.cache.Get(trackID); hit {
		return c.JSON(fiber.Map{
			"track_id":   trackID,
			"url":        stream.URL,
			"bitrate":    stream.Bitrate,
			"mime_type":  stream.MimeType,
			"itag":       stream.Itag,
			"expires_at": stream.ExpiresAtMs,
			"cached":     true,
		})
	}

	if strings.HasPrefix(trackID, "saavn:") || strings.HasPrefix(trackID, "jiosaavn:") {
		stream, failure := h.saavn.ResolveAudioStream(trackID)
		if failure != nil {
			return err.Respond(c, failure, fiber.StatusBadGateway)
		}
		h.cache.Put(trackID, *stream)
		return c.JSON(fiber.Map{
			"track_id":   trackID,
			"url":        stream.URL,
			"bitrate":    stream.Bitrate,
			"mime_type":  stream.MimeType,
			"itag":       stream.Itag,
			"expires_at": stream.ExpiresAtMs,
			"cached":     false,
			"source":     "wisewave",
		})
	}

	if strings.HasPrefix(trackID, "gaana:") {
		stream, failure := h.gaana.ResolveAudioStream(trackID)
		if failure != nil {
			return err.Respond(c, failure, fiber.StatusBadGateway)
		}
		h.cache.Put(trackID, *stream)
		return c.JSON(fiber.Map{
			"track_id":   trackID,
			"url":        stream.URL,
			"bitrate":    stream.Bitrate,
			"mime_type":  stream.MimeType,
			"itag":       stream.Itag,
			"expires_at": stream.ExpiresAtMs,
			"cached":     false,
			"source":     "wisewave",
		})
	}

	stream, failure := h.tube.ResolveAudioStream(trackID)
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusBadGateway)
	}

	h.cache.Put(trackID, *stream)
	return c.JSON(fiber.Map{
		"track_id":   trackID,
		"url":        stream.URL,
		"bitrate":    stream.Bitrate,
		"mime_type":  stream.MimeType,
		"itag":       stream.Itag,
		"expires_at": stream.ExpiresAtMs,
		"cached":     false,
		"source":     "wisewave",
	})
}

func (h *StreamHandler) HandleStream(c *fiber.Ctx) error {
	trackID := c.Params("id")

	if track, exists := h.catalog.GetTrack(trackID); exists && track.FilePath != "" {
		if _, failure := os.Stat(track.FilePath); failure == nil {
			return h.streamLocalFile(c, track.FilePath)
		}
	}

	var streamURL string
	if cachedStream, hit := h.cache.Get(trackID); hit {
		streamURL = cachedStream.URL
	} else if strings.HasPrefix(trackID, "saavn:") || strings.HasPrefix(trackID, "jiosaavn:") {
		resolved, failure := h.saavn.ResolveAudioStream(trackID)
		if failure != nil {
			return err.Respond(c, failure, fiber.StatusNotFound)
		}
		h.cache.Put(trackID, *resolved)
		streamURL = resolved.URL
	} else if strings.HasPrefix(trackID, "gaana:") {
		resolved, failure := h.gaana.ResolveAudioStream(trackID)
		if failure != nil {
			return err.Respond(c, failure, fiber.StatusNotFound)
		}
		h.cache.Put(trackID, *resolved)
		streamURL = resolved.URL
	} else {
		resolved, failure := h.tube.ResolveAudioStream(trackID)
		if failure != nil {
			return err.Respond(c, failure, fiber.StatusNotFound)
		}
		h.cache.Put(trackID, *resolved)
		streamURL = resolved.URL
	}

	if c.Query("redirect") == "true" {
		return c.Redirect(streamURL, fiber.StatusFound)
	}

	return h.proxyRemoteStream(c, streamURL)
}

func (h *StreamHandler) proxyRemoteStream(c *fiber.Ctx, remoteURL string) error {
	req, failure := http.NewRequestWithContext(c.Context(), "GET", remoteURL, nil)
	if failure != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Request creation failed")
	}

	if rangeHeader := c.Get("Range"); rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")

	resp, failure := h.httpClient.Do(req)
	if failure != nil {
		if c.Context().Err() != nil {
			return nil
		}
		return c.Status(fiber.StatusBadGateway).SendString("Remote audio fetch failed")
	}

	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusGone {
		_ = resp.Body.Close()
		trackID := c.Params("id")
		h.cache.Invalidate(trackID)
		resolved, failure := h.tube.ResolveAudioStream(trackID)
		if failure == nil {
			h.cache.Put(trackID, *resolved)
			reqRetry, errRetry := http.NewRequestWithContext(c.Context(), "GET", resolved.URL, nil)
			if errRetry == nil {
				if rangeHeader := c.Get("Range"); rangeHeader != "" {
					reqRetry.Header.Set("Range", rangeHeader)
				}
				reqRetry.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
				if respRetry, errDo := h.httpClient.Do(reqRetry); errDo == nil && respRetry.StatusCode < 400 {
					resp = respRetry
				}
			}
		}
	}

	if resp.StatusCode >= 400 {
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusRequestedRangeNotSatisfiable {
			c.Set("Content-Range", resp.Header.Get("Content-Range"))
			return c.Status(fiber.StatusRequestedRangeNotSatisfiable).SendString("Requested range not satisfiable")
		}
		return c.Status(resp.StatusCode).SendString("Remote audio fetch error")
	}

	c.Status(resp.StatusCode)
	for k, values := range resp.Header {
		if hopByHopHeaders[strings.ToLower(k)] {
			continue
		}
		for _, v := range values {
			c.Set(k, v)
		}
	}

	body := innertube.WrapIfSABR(resp)
	if strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "application/vnd.yt-ump") || strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "application/yt-ump") {
		c.Response().Header.Del("Content-Length")
	}

	return c.SendStream(body)
}

type rangeReadCloser struct {
	file   *os.File
	reader io.Reader
}

func (r *rangeReadCloser) Read(p []byte) (n int, failure error) {
	return r.reader.Read(p)
}

func (r *rangeReadCloser) Close() error {
	return r.file.Close()
}

type byteRange struct {
	start int64
	end   int64
}

func parseByteRange(rangeHeader string, fileSize int64) (*byteRange, error) {
	if !strings.HasPrefix(rangeHeader, "bytes=") {
		return nil, fmt.Errorf("invalid range unit")
	}
	spec := strings.TrimPrefix(rangeHeader, "bytes=")
	if idx := strings.Index(spec, ","); idx != -1 {
		spec = spec[:idx]
	}
	spec = strings.TrimSpace(spec)
	parts := strings.Split(spec, "-")
	if len(parts) != 2 {
		return nil, fmt.Errorf("malformed range format")
	}

	if fileSize <= 0 {
		return nil, fmt.Errorf("unsatisfiable range on empty file")
	}

	p0 := strings.TrimSpace(parts[0])
	p1 := strings.TrimSpace(parts[1])

	var start, end int64
	if p0 == "" {
		if p1 == "" {
			return nil, fmt.Errorf("empty suffix length")
		}
		suffixLen, failure := strconv.ParseInt(p1, 10, 64)
		if failure != nil || suffixLen <= 0 {
			return nil, fmt.Errorf("invalid suffix range length")
		}
		if suffixLen > fileSize {
			suffixLen = fileSize
		}
		start = fileSize - suffixLen
		end = fileSize - 1
	} else {
		var failure error
		start, failure = strconv.ParseInt(p0, 10, 64)
		if failure != nil || start < 0 {
			return nil, fmt.Errorf("invalid range start")
		}
		if p1 == "" {
			end = fileSize - 1
		} else {
			end, failure = strconv.ParseInt(p1, 10, 64)
			if failure != nil || end < start {
				return nil, fmt.Errorf("invalid range end")
			}
			if end >= fileSize {
				end = fileSize - 1
			}
		}
	}

	if start >= fileSize || start > end || end < 0 {
		return nil, fmt.Errorf("unsatisfiable range")
	}

	return &byteRange{start: start, end: end}, nil
}

func (h *StreamHandler) streamLocalFile(c *fiber.Ctx, filePath string) error {
	file, failure := os.Open(filePath)
	if failure != nil {
		return err.Respond(c, fmt.Errorf("audio file unreadable or moved"), fiber.StatusNotFound)
	}

	info, failure := file.Stat()
	if failure != nil {
		_ = file.Close()
		return err.Respond(c, fmt.Errorf("cannot read audio file metadata"), fiber.StatusInternalServerError)
	}

	fileSize := info.Size()
	contentType := getMimeType(filePath)
	c.Set("Content-Type", contentType)
	c.Set("Accept-Ranges", "bytes")

	rangeHeader := c.Get("Range")
	if rangeHeader == "" {
		c.Set("Content-Length", strconv.FormatInt(fileSize, 10))
		return c.SendStream(file)
	}

	if fileSize == 0 {
		_ = file.Close()
		c.Set("Content-Range", "bytes */0")
		return c.Status(fiber.StatusRequestedRangeNotSatisfiable).SendString("Empty file range unsatisfiable")
	}

	br, failure := parseByteRange(rangeHeader, fileSize)
	if failure != nil {
		_ = file.Close()
		c.Set("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
		return c.Status(fiber.StatusRequestedRangeNotSatisfiable).SendString("Invalid range")
	}

	contentLength := br.end - br.start + 1
	if _, failure := file.Seek(br.start, io.SeekStart); failure != nil {
		_ = file.Close()
		return c.Status(fiber.StatusInternalServerError).SendString("Seek failed")
	}

	c.Status(fiber.StatusPartialContent)
	c.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", br.start, br.end, fileSize))
	c.Set("Content-Length", strconv.FormatInt(contentLength, 10))

	streamer := &rangeReadCloser{
		file:   file,
		reader: io.LimitReader(file, contentLength),
	}
	return c.SendStream(streamer)
}

func getMimeType(filePath string) string {
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".mp3":
		return "audio/mpeg"
	case ".flac":
		return "audio/flac"
	case ".wav":
		return "audio/wav"
	case ".ogg":
		return "audio/ogg"
	case ".m4a":
		return "audio/mp4"
	case ".aac":
		return "audio/aac"
	default:
		return "application/octet-stream"
	}
}

func (h *StreamHandler) HandleArtwork(c *fiber.Ctx) error {
	trackID := c.Params("id")
	track, exists := h.catalog.GetTrack(trackID)
	if !exists || track.FilePath == "" {
		return c.Status(fiber.StatusNotFound).SendString("Track not found")
	}

	dir := filepath.Dir(track.FilePath)
	for _, name := range []string{"cover.jpg", "cover.png", "folder.jpg", "folder.png", "album.jpg"} {
		path := filepath.Join(dir, name)
		if _, failure := os.Stat(path); failure == nil {
			return c.SendFile(path)
		}
	}

	return c.Status(fiber.StatusNotFound).SendString("No artwork file found")
}
