package desktop

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

const (
	audioRangeSize int64 = 1 << 20
	audioUserAgent       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
)

func openAudioStream(ctx context.Context, client *http.Client, streamURL, userAgent string) (*http.Response, error) {
	response, err := audioRangeRequest(ctx, client, streamURL, userAgent, 0, true)
	if err != nil || response.StatusCode != http.StatusPartialContent {
		return response, err
	}
	if isUMPResponse(response) {
		_ = response.Body.Close()
		return audioRangeRequest(ctx, client, streamURL, userAgent, 0, false)
	}
	start, end, total, ok := parseAudioContentRange(response.Header.Get("Content-Range"), streamURL)
	if !ok || start != 0 || end >= total || end >= audioRangeSize {
		_ = response.Body.Close()
		return nil, fmt.Errorf("invalid audio range %q", response.Header.Get("Content-Range"))
	}
	response.Body = &audioRangeReader{
		ctx: ctx, client: client, streamURL: streamURL, userAgent: userAgent,
		body: response.Body, total: total, end: end,
	}
	response.ContentLength = total
	response.StatusCode = http.StatusOK
	response.Status = "200 OK"
	return response, nil
}

func audioRangeRequest(ctx context.Context, client *http.Client, streamURL, userAgent string, start int64, ranged bool) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, streamURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", userAgent)
	if ranged {
		request.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, start+audioRangeSize-1))
	}
	return client.Do(request)
}

func parseAudioContentRange(value, streamURL string) (int64, int64, int64, bool) {
	parts := strings.Fields(value)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bytes") {
		return 0, 0, 0, false
	}
	rangeAndTotal := strings.SplitN(parts[1], "/", 2)
	if len(rangeAndTotal) != 2 {
		return 0, 0, 0, false
	}
	bounds := strings.SplitN(rangeAndTotal[0], "-", 2)
	if len(bounds) != 2 {
		return 0, 0, 0, false
	}
	start, startErr := strconv.ParseInt(bounds[0], 10, 64)
	end, endErr := strconv.ParseInt(bounds[1], 10, 64)
	total, totalErr := strconv.ParseInt(rangeAndTotal[1], 10, 64)
	if rangeAndTotal[1] == "*" {
		if parsed, err := url.Parse(streamURL); err == nil {
			total, totalErr = strconv.ParseInt(parsed.Query().Get("clen"), 10, 64)
		}
	}
	return start, end, total, startErr == nil && endErr == nil && totalErr == nil && start >= 0 && end >= start && total > end
}

func isUMPResponse(response *http.Response) bool {
	contentType := strings.ToLower(response.Header.Get("Content-Type"))
	return strings.Contains(contentType, "application/vnd.yt-ump") || strings.Contains(contentType, "application/yt-ump")
}

type audioRangeReader struct {
	ctx       context.Context
	client    *http.Client
	streamURL string
	userAgent string
	mu        sync.Mutex
	body      io.ReadCloser
	total     int64
	offset    int64
	end       int64
	emptyRead int
	closed    atomic.Bool
}

func (r *audioRangeReader) Read(buffer []byte) (int, error) {
	if len(buffer) == 0 {
		return 0, nil
	}
	for {
		if r.closed.Load() {
			return 0, io.ErrClosedPipe
		}
		if r.offset >= r.total {
			return 0, io.EOF
		}
		body := r.currentBody()
		if body == nil {
			if err := r.openNext(); err != nil {
				return 0, err
			}
			body = r.currentBody()
		}
		remaining := r.end - r.offset + 1
		if remaining <= 0 {
			r.clearBody(body)
			continue
		}
		readBuffer := buffer
		if int64(len(readBuffer)) > remaining {
			readBuffer = readBuffer[:int(remaining)]
		}
		n, err := body.Read(readBuffer)
		r.offset += int64(n)
		if n > 0 {
			r.emptyRead = 0
		}
		if r.offset > r.end || err == io.EOF {
			r.clearBody(body)
		}
		if err != nil && err != io.EOF {
			r.clearBody(body)
			return n, err
		}
		if err == io.EOF && r.offset <= r.end {
			r.emptyRead++
			if r.emptyRead >= 3 {
				return n, io.ErrUnexpectedEOF
			}
		}
		if n > 0 {
			return n, nil
		}
		if err == io.EOF {
			continue
		}
		r.emptyRead++
		if r.emptyRead >= 100 {
			return 0, io.ErrNoProgress
		}
	}
}

func (r *audioRangeReader) openNext() error {
	start := r.offset
	requestedEnd := min(start+audioRangeSize-1, r.total-1)
	response, err := audioRangeRequest(r.ctx, r.client, r.streamURL, r.userAgent, start, true)
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusPartialContent {
		_ = response.Body.Close()
		return fmt.Errorf("audio range returned HTTP %d", response.StatusCode)
	}
	actualStart, end, total, ok := parseAudioContentRange(response.Header.Get("Content-Range"), r.streamURL)
	if !ok || actualStart != start || end > requestedEnd || total != r.total {
		_ = response.Body.Close()
		return fmt.Errorf("invalid audio range %q", response.Header.Get("Content-Range"))
	}
	if r.closed.Load() {
		_ = response.Body.Close()
		return io.ErrClosedPipe
	}
	r.mu.Lock()
	r.body = response.Body
	r.mu.Unlock()
	r.end = end
	return nil
}

func (r *audioRangeReader) Close() error {
	r.closed.Store(true)
	r.mu.Lock()
	body := r.body
	r.mu.Unlock()
	if body != nil {
		return body.Close()
	}
	return nil
}

func (r *audioRangeReader) currentBody() io.ReadCloser {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.body
}

func (r *audioRangeReader) clearBody(body io.ReadCloser) {
	_ = body.Close()
	r.mu.Lock()
	if r.body == body {
		r.body = nil
	}
	r.mu.Unlock()
}
