package innertube

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Loudness struct {
	LoudnessDB float64
}

func parseLoudness(raw json.RawMessage) (Loudness, error) {
	var response struct {
		PlayabilityStatus struct {
			Status string `json:"status"`
		} `json:"playabilityStatus"`
		PlayerConfig struct {
			AudioConfig struct {
				PerceptualLoudnessDb float64 `json:"perceptualLoudnessDb"`
				LoudnessDb           float64 `json:"loudnessDb"`
			} `json:"audioConfig"`
		} `json:"playerConfig"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return Loudness{}, err
	}
	if response.PlayabilityStatus.Status == "UNPLAYABLE" {
		return Loudness{}, errors.New("youtube: player response is unplayable")
	}
	audio := response.PlayerConfig.AudioConfig
	if audio.LoudnessDb != 0 {
		return Loudness{LoudnessDB: audio.LoudnessDb}, nil
	}
	if audio.PerceptualLoudnessDb != 0 {
		return Loudness{LoudnessDB: audio.PerceptualLoudnessDb}, nil
	}
	return Loudness{}, errors.New("youtube: player response has no loudness metadata")
}

func (client *MusicClient) Loudness(ctx context.Context, videoID string) (Loudness, error) {
	if strings.TrimSpace(videoID) == "" {
		return Loudness{}, errors.New("youtube: loudness requires a video ID")
	}
	raw, err := client.executeAs(ctx, webClient, false, "player", map[string]any{
		"videoId":         videoID,
		"playbackContext": map[string]any{"contentPlaybackContext": map[string]any{}},
	})
	if err != nil {
		return Loudness{}, err
	}
	return parseLoudness(raw)
}

type StreamDetails struct {
	URL      string
	Duration time.Duration
	Bitrate  int
	MimeType string
}

func (client *MusicClient) AudioStream(ctx context.Context, videoID string) (StreamDetails, error) {
	if strings.TrimSpace(videoID) == "" {
		return StreamDetails{}, errors.New("youtube: audio stream requires a video ID")
	}

	c := &Client{
		MusicClient: client,
		httpClient:  client.httpClient,
	}

	stream, err := c.ResolveAudio(ctx, videoID, StreamOptions{
		PreferredCodec: CodecOpus,
		RequireCodec:   true,
		Validate:       true,
	})
	if err != nil {
		return StreamDetails{}, err
	}

	return StreamDetails{
		URL:      stream.URL,
		Duration: time.Duration(stream.DurationMs) * time.Millisecond,
		Bitrate:  stream.Bitrate,
		MimeType: stream.MimeType,
	}, nil
}

func (client *MusicClient) ReportPlayback(ctx context.Context, videoID string) error {
	_, err := client.reportPlayback(ctx, videoID, 0, 0, false)
	return err
}

type PlaybackSession struct {
	client       *MusicClient
	watchtimeURL *url.URL
	cpn          string
	startedAt    time.Time
}

func (client *MusicClient) BeginEpisodePlayback(ctx context.Context, videoID string, position, duration time.Duration) (*PlaybackSession, error) {
	return client.reportPlayback(ctx, videoID, position, duration, true)
}

func (c *MusicClient) reportPlayback(ctx context.Context, videoID string, position, duration time.Duration, withWatchtime bool) (*PlaybackSession, error) {
	if c.cookieAuth.Load() == nil || strings.TrimSpace(videoID) == "" {
		return nil, nil
	}
	raw, err := c.execute(ctx, "player", map[string]any{
		"videoId":         videoID,
		"playbackContext": map[string]any{"contentPlaybackContext": map[string]any{}},
	})
	if err != nil {
		return nil, err
	}
	root := decodeResponse(raw)
	playbackURL, err := trackingURL(root, "videostatsPlaybackUrl")
	if err != nil {
		return nil, err
	}
	var watchtimeURL *url.URL
	if withWatchtime {
		watchtimeURL, err = trackingURL(root, "videostatsWatchtimeUrl")
		if err != nil {
			return nil, err
		}
	}
	cpn := clientPlaybackNonce()
	params := url.Values{
		"ver": {"2"},
		"c":   {defaultMusicContext},
		"cpn": {cpn},
	}
	if withWatchtime {
		params.Set("state", "playing")
		params.Set("cmt", seconds(position))
		params.Set("len", seconds(duration))
		params.Set("rt", "0")
	}
	if err := c.pingTracking(ctx, playbackURL, params, "playback"); err != nil {
		return nil, err
	}
	if !withWatchtime {
		return nil, nil
	}
	return &PlaybackSession{client: c, watchtimeURL: watchtimeURL, cpn: cpn, startedAt: time.Now()}, nil
}

func (s *PlaybackSession) ReportWatchtime(ctx context.Context, from, to, duration time.Duration, state string, final bool) error {
	if s == nil || s.client == nil || s.watchtimeURL == nil {
		return nil
	}
	params := url.Values{
		"ver":   {"2"},
		"c":     {defaultMusicContext},
		"cpn":   {s.cpn},
		"st":    {seconds(from)},
		"et":    {seconds(to)},
		"cmt":   {seconds(to)},
		"len":   {seconds(duration)},
		"state": {state},
		"rt":    {seconds(time.Since(s.startedAt))},
	}
	if final {
		params.Set("final", "1")
	}
	return s.client.pingTracking(ctx, s.watchtimeURL, params, "watchtime")
}

func trackingURL(root any, key string) (*url.URL, error) {
	tracking := findRenderer(root, key)
	base, _ := tracking.get("baseUrl").(string)
	if base == "" {
		return nil, errors.New("youtube: player response has no " + key)
	}
	target, err := url.Parse(base)
	if err != nil {
		return nil, err
	}
	return target, nil
}

func (client *MusicClient) pingTracking(ctx context.Context, target *url.URL, params url.Values, operation string) error {
	if !client.allowInsecureCookieAuth && !isYouTubeURL(target) {
		return errors.New("youtube: refusing to send cookie authentication to a non-YouTube or non-HTTPS URL")
	}
	query := target.Query()

	for key, values := range params {
		query.Del(key)
		for _, value := range values {
			query.Add(key, value)
		}
	}
	requestURL := *target
	requestURL.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", browserUserAgent)
	req.Header.Set("Referer", "https://music.youtube.com/")
	client.setIdentity(req, client.currentVisitorData())
	resp, err := client.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return responseError(operation, resp)
	}
	return nil
}

func seconds(d time.Duration) string {
	return strconv.FormatFloat(d.Seconds(), 'f', 3, 64)
}

func clientPlaybackNonce() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = alphabet[b[i]&63]
	}
	return string(b)
}
