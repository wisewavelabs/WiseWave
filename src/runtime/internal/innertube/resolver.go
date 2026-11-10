package innertube

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

type AudioCodec int

const (
	CodecAny AudioCodec = iota
	CodecOpus
	CodecAAC
)

type StreamOptions struct {
	PreferredCodec AudioCodec
	RequireCodec   bool
	Validate       bool
	MaxBitrate     int
	Timeout        time.Duration
}

type singleflightCall struct {
	done chan struct{}
	val  *ResolvedAudioStream
	err  error
}

type singleflightGroup struct {
	mu sync.Mutex
	m  map[string]*singleflightCall
}

func (g *singleflightGroup) Do(key string, fn func() (*ResolvedAudioStream, error)) (*ResolvedAudioStream, error) {
	return g.DoContext(context.Background(), key, fn)
}

func (g *singleflightGroup) DoContext(ctx context.Context, key string, fn func() (*ResolvedAudioStream, error)) (*ResolvedAudioStream, error) {
	g.mu.Lock()
	if g.m == nil {
		g.m = make(map[string]*singleflightCall)
	}
	if c, ok := g.m[key]; ok {
		g.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-c.done:
			if ctx.Err() == nil && (errors.Is(c.err, context.Canceled) || errors.Is(c.err, context.DeadlineExceeded)) {
				return g.DoContext(ctx, key, fn)
			}
			return c.val, c.err
		}
	}
	c := &singleflightCall{done: make(chan struct{})}
	g.m[key] = c
	g.mu.Unlock()

	c.val, c.err = fn()
	g.mu.Lock()
	delete(g.m, key)
	close(c.done)
	g.mu.Unlock()

	return c.val, c.err
}

var ExtendedPlayerClients = []PlayerClient{
	{
		Name:      "IOS_MUSIC",
		Version:   "7.27.0",
		APIKey:    "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc",
		UserAgent: "com.google.ios.youtubemusic/7.27.0 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)",
		OSName:    "iOS",
		OSVersion: "17.5.1",
	},
	{
		Name:      "ANDROID_VR",
		Version:   "1.65.10",
		APIKey:    "AIzaSyD-p045F_WzU-vA_YgX20SCx4KAo",
		UserAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
		OSName:    "Android",
		OSVersion: "12",
	},
	{
		Name:      "VISIONOS",
		Version:   visionOSVersion,
		APIKey:    "AIzaSyAO_FJ2SlqAz8GlBg1fA54p0wDE7Xk80mU",
		UserAgent: visionOSUserAgent,
		OSName:    "visionOS",
		OSVersion: "26.5.23O471",
	},
	{
		Name:      "ANDROID_MUSIC",
		Version:   androidMusicVersion,
		APIKey:    "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc",
		UserAgent: androidMusicUserAgent,
		OSName:    "Android",
		OSVersion: "14",
	},
	{
		Name:      "TVHTML5",
		Version:   "7.20260308.08.00",
		APIKey:    "AIzaSyAO_FJ2SlqAz8GlBg1fA54p0wDE7Xk80mU",
		UserAgent: "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/76.0.3809.146 TV Safari/537.36",
	},
	{
		Name:      "WEB_REMIX",
		Version:   "1.20260707.12.00",
		APIKey:    "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30",
		UserAgent: browserUserAgent,
	},
}

func (c *Client) ResolveAudio(ctx context.Context, videoID string, opts StreamOptions) (*ResolvedAudioStream, error) {
	if strings.TrimSpace(videoID) == "" {
		return nil, errors.New("youtube: resolve requires video id")
	}

	flightKey := fmt.Sprintf("%s:%d:%t:%t:%d", videoID, opts.PreferredCodec, opts.RequireCodec, opts.Validate, opts.MaxBitrate)
	return c.flights.DoContext(ctx, flightKey, func() (*ResolvedAudioStream, error) {
		return c.doResolveAudio(ctx, videoID, opts)
	})
}

func (c *Client) doResolveAudio(ctx context.Context, videoID string, opts StreamOptions) (*ResolvedAudioStream, error) {
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	c.clientPreference.RLock()
	preferred := c.preferredClient
	c.clientPreference.RUnlock()

	var clientList []PlayerClient
	for _, client := range ExtendedPlayerClients {
		if client.Name == preferred {
			clientList = append(clientList, client)
			break
		}
	}
	for _, client := range ExtendedPlayerClients {
		if client.Name != preferred {
			clientList = append(clientList, client)
		}
	}

	var lastErr error
	for _, client := range clientList {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		stream, err := c.resolveFromPlayerEndpoint(ctx, videoID, client, opts)
		if err != nil {
			lastErr = err
			continue
		}

		if opts.Validate {
			if probeErr := c.probeStream(ctx, stream.URL, client.UserAgent); probeErr != nil {
				decoded, decodeErr := c.decryptStream(ctx, stream.URL, "", "")
				if decodeErr != nil {
					lastErr = fmt.Errorf("stream validation: %v; cipher: %w", probeErr, decodeErr)
					continue
				}
				if decoded == stream.URL {
					lastErr = probeErr
					continue
				}
				if retryErr := c.probeStream(ctx, decoded, client.UserAgent); retryErr != nil {
					lastErr = retryErr
					continue
				}
				stream.URL = decoded
			}
		}

		c.clientPreference.Lock()
		c.preferredClient = client.Name
		c.clientPreference.Unlock()
		return stream, nil
	}

	if lastErr != nil {
		return nil, fmt.Errorf("unable to resolve playable audio stream for %s: %w", videoID, lastErr)
	}
	return nil, fmt.Errorf("no playable audio stream found for %s", videoID)
}

func (c *Client) resolveFromPlayerEndpoint(ctx context.Context, videoID string, client PlayerClient, opts StreamOptions) (*ResolvedAudioStream, error) {
	endpoint := fmt.Sprintf("https://music.youtube.com/youtubei/v1/player?key=%s", client.APIKey)

	hl := "en"
	gl := "US"
	if c.MusicClient != nil {
		if c.MusicClient.language != "" {
			hl = c.MusicClient.language
		}
		if c.MusicClient.country != "" {
			gl = c.MusicClient.country
		}
	}

	clientContext := map[string]interface{}{
		"clientName":    client.Name,
		"clientVersion": client.Version,
		"hl":            hl,
		"gl":            gl,
	}
	if client.OSName != "" {
		clientContext["osName"] = client.OSName
		clientContext["osVersion"] = client.OSVersion
	}
	if visitorData := c.currentVisitor(); visitorData != "" {
		clientContext["visitorData"] = visitorData
	}

	payload := map[string]interface{}{
		"context": map[string]interface{}{
			"client": clientContext,
		},
		"videoId": videoID,
		"playbackContext": map[string]interface{}{
			"contentPlaybackContext": map[string]interface{}{
				"html5Preference": "HTML5_PREF_WANTS",
			},
		},
		"contentCheckOk": true,
		"racyCheckOk":    true,
	}

	streamToken := ""
	if client.Name == "WEB_REMIX" && c.MusicClient != nil && c.MusicClient.tokens != nil {
		visitor := c.currentVisitor()
		if visitor == "" {
			if _, err := c.MusicClient.executeAs(ctx, musicClient, false, "visitor_id", map[string]any{}); err != nil {
				return nil, fmt.Errorf("obtain visitor: %w", err)
			}
			visitor = c.currentVisitor()
		}
		playerToken, token, err := c.MusicClient.tokens(ctx, videoID, visitor)
		if err != nil {
			return nil, fmt.Errorf("generate playback token: %w", err)
		}
		clientContext["visitorData"] = visitor
		payload["serviceIntegrityDimensions"] = map[string]string{"poToken": playerToken}
		streamToken = token
	}

	var respBytes []byte
	if client.Name == "VISIONOS" && c.MusicClient != nil {
		var err error
		respBytes, err = c.MusicClient.executeAs(ctx, visionOSClient, false, "player", payload)
		if err != nil {
			return nil, err
		}
	} else {
		bodyBytes, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
		if err != nil {
			return nil, err
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", client.UserAgent)
		req.Header.Set("Origin", "https://music.youtube.com")
		req.Header.Set("Referer", "https://music.youtube.com/")
		if client.Name == "WEB_REMIX" {
			req.Header.Set("X-YouTube-Client-Name", "67")
			req.Header.Set("X-YouTube-Client-Version", client.Version)
		}
		if visitorData := c.currentVisitor(); visitorData != "" {
			req.Header.Set("X-Goog-Visitor-Id", visitorData)
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("player returned HTTP %d", resp.StatusCode)
		}

		respBytes, err = io.ReadAll(io.LimitReader(resp.Body, 16<<20))
		if err != nil {
			return nil, err
		}
	}

	var root map[string]interface{}
	if err := json.Unmarshal(respBytes, &root); err != nil {
		return nil, err
	}

	if playability, ok := safeMap(root["playabilityStatus"]); ok {
		status := safeString(playability["status"])
		if status != "" && status != "OK" {
			reason := safeString(playability["reason"])
			return nil, fmt.Errorf("playability status: %s (%s)", status, reason)
		}
	}

	if responseCtx, ok := safeMap(root["responseContext"]); ok {
		if vData := safeString(responseCtx["visitorData"]); vData != "" && c.MusicClient != nil {
			c.MusicClient.rememberVisitorData(vData)
		}
	}

	streamingData, ok := safeMap(root["streamingData"])
	if !ok {
		return nil, errors.New("no streamingData in response")
	}

	formats := extractAudioCandidates(streamingData)
	formats = slices.DeleteFunc(formats, func(format map[string]interface{}) bool {
		mime := strings.ToLower(safeString(format["mimeType"]))
		if opts.RequireCodec && ((opts.PreferredCodec == CodecOpus && !strings.Contains(mime, "opus")) || (opts.PreferredCodec == CodecAAC && !strings.Contains(mime, "mp4a") && !strings.Contains(mime, "aac"))) {
			return true
		}
		if safeString(format["url"]) != "" {
			return false
		}
		cipher := safeString(format["signatureCipher"])
		if cipher == "" {
			cipher = safeString(format["cipher"])
		}
		values, err := url.ParseQuery(cipher)
		return err != nil || values.Get("url") == ""
	})
	if len(formats) > 0 {
		chosen := chooseBestAudioFormat(formats, opts.PreferredCodec, opts.MaxBitrate)
		if chosen != nil {
			directURL := safeString(chosen["url"])
			if directURL == "" {
				cipher := safeString(chosen["signatureCipher"])
				if cipher == "" {
					cipher = safeString(chosen["cipher"])
				}
				values, err := url.ParseQuery(cipher)
				if err != nil {
					return nil, err
				}
				if values.Get("s") != "" {
					directURL, err = c.decryptStream(ctx, values.Get("url"), values.Get("s"), values.Get("sp"))
					if err != nil {
						return nil, err
					}
				} else {
					directURL = decipherSignatureCipher(cipher)
				}
			}

			if directURL != "" {
				if streamToken != "" {
					parsed, err := url.Parse(directURL)
					if err != nil {
						return nil, err
					}
					query := parsed.Query()
					query.Set("pot", streamToken)
					parsed.RawQuery = query.Encode()
					directURL = parsed.String()
				}
				mimeType := safeString(chosen["mimeType"])
				bitrate := safeInt(chosen["bitrate"])
				itag := safeInt(chosen["itag"])

				var durationMs int64
				if approx := safeString(chosen["approxDurationMs"]); approx != "" {
					durationMs, _ = strconv.ParseInt(approx, 10, 64)
				}
				var contentLength int64
				if cl := safeString(chosen["contentLength"]); cl != "" {
					contentLength, _ = strconv.ParseInt(cl, 10, 64)
				}

				expiresAt := parseExpirationTimestamp(directURL)
				loudness := extractLoudness(root)
				codec := "Opus"
				if strings.Contains(mimeType, "mp4a") || strings.Contains(mimeType, "aac") {
					codec = "AAC"
				}

				return &ResolvedAudioStream{
					VideoID:       videoID,
					URL:           directURL,
					MimeType:      mimeType,
					Bitrate:       bitrate,
					Itag:          itag,
					DurationMs:    durationMs,
					ContentLength: contentLength,
					ExpiresAtMs:   expiresAt,
					LoudnessDB:    loudness,
					Codec:         codec,
					IsHLS:         false,
				}, nil
			}
		}
	}

	if hlsURL := safeString(streamingData["hlsManifestUrl"]); hlsURL != "" && !opts.RequireCodec {
		return &ResolvedAudioStream{
			VideoID:     videoID,
			URL:         hlsURL,
			MimeType:    "application/x-mpegURL",
			ExpiresAtMs: time.Now().Add(6 * time.Hour).UnixMilli(),
			Codec:       "AAC",
			IsHLS:       true,
		}, nil
	}

	return nil, errors.New("no playable audio format or manifest found")
}

func extractAudioCandidates(streamingData map[string]interface{}) []map[string]interface{} {
	var results []map[string]interface{}

	if adaptive, ok := safeSlice(streamingData["adaptiveFormats"]); ok {
		for _, item := range adaptive {
			if fm, ok := safeMap(item); ok {
				mime := safeString(fm["mimeType"])
				if strings.HasPrefix(mime, "audio/") {
					results = append(results, fm)
				}
			}
		}
	}

	if len(results) == 0 {
		if regular, ok := safeSlice(streamingData["formats"]); ok {
			for _, item := range regular {
				if fm, ok := safeMap(item); ok {
					mime := safeString(fm["mimeType"])
					if strings.HasPrefix(mime, "audio/") {
						results = append(results, fm)
					}
				}
			}
		}
	}

	return results
}

func chooseBestAudioFormat(formats []map[string]interface{}, preferred AudioCodec, maxBitrate int) map[string]interface{} {
	if len(formats) == 0 {
		return nil
	}

	valid := make([]map[string]interface{}, 0, len(formats))
	for _, f := range formats {
		if track, ok := safeMap(f["audioTrack"]); ok {
			if isDef, hasDef := track["audioIsDefault"].(bool); hasDef && !isDef {
				continue
			}
		}
		valid = append(valid, f)
	}
	if len(valid) == 0 {
		valid = formats
	}
	if maxBitrate > 0 {
		limited := make([]map[string]interface{}, 0, len(valid))
		for _, format := range valid {
			if safeInt(format["bitrate"]) <= maxBitrate {
				limited = append(limited, format)
			}
		}
		if len(limited) > 0 {
			valid = limited
		}
	}

	var nonDRC []map[string]interface{}
	for _, f := range valid {
		isDrc, _ := f["isDrc"].(bool)
		if !isDrc {
			nonDRC = append(nonDRC, f)
		}
	}
	candidates := nonDRC
	if len(candidates) == 0 {
		candidates = valid
	}

	scoreFormat := func(f map[string]interface{}) int {
		bitrate := safeInt(f["bitrate"])
		mime := safeString(f["mimeType"])
		isOpus := strings.Contains(mime, "opus")
		isAAC := strings.Contains(mime, "mp4a") || strings.Contains(mime, "aac")

		codecBonus := 0
		switch preferred {
		case CodecOpus:
			if isOpus {
				codecBonus = 500000
			}
		case CodecAAC:
			if isAAC {
				codecBonus = 500000
			}
		case CodecAny:
			if isOpus {
				codecBonus = 20000
			}
		}

		return bitrate + codecBonus
	}

	var best map[string]interface{}
	bestScore := -1
	for _, f := range candidates {
		s := scoreFormat(f)
		if s > bestScore {
			bestScore = s
			best = f
		}
	}
	return best
}

func decipherSignatureCipher(cipher string) string {
	values, err := url.ParseQuery(cipher)
	if err != nil {
		return ""
	}
	directURL := values.Get("url")
	if directURL == "" {
		return ""
	}

	if values.Get("s") != "" {
		return ""
	}
	sig := values.Get("sig")
	if sig == "" {
		sig = values.Get("signature")
	}
	sp := values.Get("sp")
	if sp == "" {
		sp = "sig"
	}

	if sig != "" {
		parsed, err := url.Parse(directURL)
		if err != nil {
			return ""
		}
		q := parsed.Query()
		q.Set(sp, sig)
		parsed.RawQuery = q.Encode()
		directURL = parsed.String()
	}

	return directURL
}

func extractLoudness(root map[string]interface{}) float64 {
	playerConfig, ok := safeMap(root["playerConfig"])
	if !ok {
		return 0
	}
	audioConfig, ok := safeMap(playerConfig["audioConfig"])
	if !ok {
		return 0
	}
	if val := safeFloat(audioConfig["loudnessDb"]); val != 0 {
		return val
	}
	if val := safeFloat(audioConfig["perceptualLoudnessDb"]); val != 0 {
		return val
	}
	return 0
}

func (c *Client) probeStream(ctx context.Context, mediaURL, userAgent string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, mediaURL, nil)
	if err != nil {
		return err
	}
	if userAgent != "" {
		req.Header.Set("User-Agent", userAgent)
	} else {
		req.Header.Set("User-Agent", browserUserAgent)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("probe failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("probe returned HTTP %d", resp.StatusCode)
	}

	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.Contains(contentType, "yt-ump") {
		return errors.New("sabr/ump stream rejected: requires continuous sabr session management")
	}

	limitReader := io.LimitReader(resp.Body, 128)
	sample, err := io.ReadAll(limitReader)
	if err != nil && err != io.EOF {
		return fmt.Errorf("probe read error: %w", err)
	}

	startsAtZero := true
	if resp.StatusCode == http.StatusPartialContent {
		cr := resp.Header.Get("Content-Range")
		if cr != "" {
			fields := strings.Fields(cr)
			if len(fields) == 2 && strings.EqualFold(fields[0], "bytes") {
				rangeAndTotal := strings.Split(fields[1], "/")
				if len(rangeAndTotal) > 0 {
					bounds := strings.Split(rangeAndTotal[0], "-")
					if len(bounds) > 0 {
						if startOffset, parseErr := strconv.ParseInt(bounds[0], 10, 64); parseErr == nil && startOffset > 0 {
							startsAtZero = false
						}
					}
				}
			}
		}
	}

	if !isValidAudioContainerOrManifest(sample, mediaURL, contentType, startsAtZero) {
		return errors.New("unrecognized audio container or manifest format")
	}

	return nil
}

func isValidAudioContainerOrManifest(data []byte, mediaURL, contentType string, startsAtZero bool) bool {
	ct := strings.ToLower(contentType)
	if strings.Contains(ct, "yt-ump") {
		return false
	}

	if strings.Contains(ct, "mpegurl") || strings.HasSuffix(strings.Split(mediaURL, "?")[0], ".m3u8") || bytes.HasPrefix(data, []byte("#EXTM3U")) {
		return true
	}

	if !startsAtZero {
		return strings.HasPrefix(ct, "audio/") || strings.HasPrefix(ct, "video/") || ct == "application/octet-stream"
	}

	if len(data) < 4 {
		return false
	}

	if bytes.HasPrefix(data, []byte{0x1A, 0x45, 0xDF, 0xA3}) {
		return true
	}
	if bytes.HasPrefix(data, []byte("OggS")) {
		return true
	}
	if bytes.HasPrefix(data, []byte("fLaC")) {
		return true
	}
	if isMP3Sync(data) {
		return true
	}

	if isISOBMFF(data) {
		return true
	}

	if strings.HasPrefix(ct, "audio/") {
		return true
	}

	return false
}

func isMP3Sync(data []byte) bool {
	if len(data) < 4 {
		return false
	}
	if bytes.HasPrefix(data, []byte("ID3")) {
		return true
	}
	if data[0] == 0xFF && (data[1]&0xE0) == 0xE0 {
		version := (data[1] >> 3) & 0x03
		layer := (data[1] >> 1) & 0x03
		bitrate := (data[2] >> 4) & 0x0F
		samplerate := (data[2] >> 2) & 0x03
		if version != 1 && layer != 0 && bitrate != 0x0F && samplerate != 0x03 {
			return true
		}
	}
	return false
}

func isISOBMFF(data []byte) bool {
	offset := 0
	for offset+8 <= len(data) {
		boxSize := int(binary.BigEndian.Uint32(data[offset : offset+4]))
		boxType := string(data[offset+4 : offset+8])

		switch boxType {
		case "ftyp", "styp", "moov", "moof", "mdat":
			return true
		case "free", "skip", "wide":
			if boxSize < 8 {
				return true
			}
			offset += boxSize
		default:
			if offset == 0 && boxSize >= 8 && isPrintableASCII(data[offset+4:offset+8]) {
				offset += boxSize
			} else {
				return false
			}
		}
	}
	return false
}

func isPrintableASCII(b []byte) bool {
	for _, c := range b {
		if c < 0x20 || c > 0x7E {
			return false
		}
	}
	return true
}

func parseExpirationTimestamp(mediaURL string) int64 {
	if u, err := url.Parse(mediaURL); err == nil {
		if expStr := u.Query().Get("expire"); expStr != "" {
			if expSec, err := strconv.ParseInt(expStr, 10, 64); err == nil {
				return expSec * 1000
			}
		}
	}
	return time.Now().Add(6 * time.Hour).UnixMilli()
}

func (c *Client) currentVisitor() string {
	if c.MusicClient != nil {
		return c.MusicClient.currentVisitorData()
	}
	return ""
}

func safeMap(v interface{}) (map[string]interface{}, bool) {
	if m, ok := v.(map[string]interface{}); ok && m != nil {
		return m, true
	}
	return nil, false
}

func safeSlice(v interface{}) ([]interface{}, bool) {
	if s, ok := v.([]interface{}); ok && s != nil {
		return s, true
	}
	return nil, false
}

func safeString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func safeInt(v interface{}) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	case string:
		parsed, _ := strconv.Atoi(n)
		return parsed
	}
	return 0
}

func safeFloat(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case string:
		parsed, _ := strconv.ParseFloat(n, 64)
		return parsed
	}
	return 0
}

var (
	junkRemixPattern = regexp.MustCompile(`(?i)\b(slowed(\s*\+\s*reverb)?|reverb|8d\s*audio|nightcore|tribute)\b`)
	junkCoverPattern = regexp.MustCompile(`(?i)\bcover\b`)
)

func IsJunkTrack(title, originalQuery string) bool {
	q := strings.ToLower(originalQuery)
	t := strings.ToLower(title)

	if !strings.Contains(q, "slowed") && !strings.Contains(q, "reverb") && !strings.Contains(q, "nightcore") && !strings.Contains(q, "8d") {
		if junkRemixPattern.MatchString(t) {
			return true
		}
	}
	if !strings.Contains(q, "cover") {
		if junkCoverPattern.MatchString(t) {
			return true
		}
	}
	return false
}

func CalculateLoudnessGain(loudnessDB float64, normalize bool) float64 {
	if !normalize || loudnessDB <= 0 {
		return 1.0
	}
	return math.Min(1.0, math.Pow(10, -loudnessDB/20.0))
}
