package innertube

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const cipherEndpoint = "https://cipher.kikkia.dev/decrypt_signature"

var playerScriptCache struct {
	sync.Mutex
	url     string
	expires time.Time
}

var playerScriptPattern = regexp.MustCompile(`"jsUrl"\s*:\s*("(?:[^"\\]|\\.)*")`)

func (c *Client) playerScript(ctx context.Context) (string, error) {
	playerScriptCache.Lock()
	defer playerScriptCache.Unlock()
	if playerScriptCache.url != "" && time.Now().Before(playerScriptCache.expires) {
		return playerScriptCache.url, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.youtube.com/embed/", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", browserUserAgent)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch player script: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("fetch player script: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", err
	}
	matches := playerScriptPattern.FindSubmatch(body)
	if len(matches) != 2 {
		return "", errors.New("player script unavailable")
	}
	script, err := strconv.Unquote(string(matches[1]))
	if err != nil {
		return "", err
	}
	parsed, err := url.Parse(script)
	if err != nil {
		return "", err
	}
	if !parsed.IsAbs() {
		parsed = (&url.URL{Scheme: "https", Host: "www.youtube.com"}).ResolveReference(parsed)
	}
	if parsed.Scheme != "https" || parsed.Hostname() != "www.youtube.com" || !strings.HasPrefix(parsed.Path, "/s/player/") {
		return "", errors.New("invalid player script URL")
	}
	playerScriptCache.url, playerScriptCache.expires = parsed.String(), time.Now().Add(6*time.Hour)
	return playerScriptCache.url, nil
}

func (c *Client) decryptStream(ctx context.Context, rawURL, signature, signatureKey string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "https" || !strings.HasSuffix(parsed.Hostname(), ".googlevideo.com") {
		return "", errors.New("invalid audio stream URL")
	}
	query := parsed.Query()
	n := query.Get("n")
	if signature == "" && n == "" {
		return rawURL, nil
	}
	script, err := c.playerScript(ctx)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(map[string]string{"player_url": script, "encrypted_signature": signature, "n_param": n})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cipherEndpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "WiseWave")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("cipher service: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("cipher service: HTTP %d", resp.StatusCode)
	}
	var result struct {
		Signature string `json:"decrypted_signature"`
		N         string `json:"decrypted_n_sig"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&result); err != nil {
		return "", fmt.Errorf("cipher response: %w", err)
	}
	if signature != "" {
		if result.Signature == "" {
			return "", errors.New("cipher service returned no signature")
		}
		if signatureKey == "" {
			signatureKey = "sig"
		}
		query.Set(signatureKey, result.Signature)
	}
	if n != "" {
		if result.N == "" {
			return "", errors.New("cipher service returned no n value")
		}
		query.Set("n", result.N)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}
