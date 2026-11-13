package spotify

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
)

const (
	tokenURL      = "https://open.spotify.com/api/token"
	serverTimeURL = "https://open.spotify.com/api/server-time"
	nuanceGistURL = "https://gist.githubusercontent.com/sonic-liberation/22ed9c6ba463899e933427f7de1f0eef/raw/"
	webUserAgent  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

type InternalToken struct {
	AccessToken                         string `json:"accessToken"`
	AccessTokenExpirationTimestampMs    int64  `json:"accessTokenExpirationTimestampMs"`
	IsAnonymous                         bool   `json:"isAnonymous"`
	ClientID                            string `json:"clientId"`
}

type nuance struct {
	Secret  string `json:"s"`
	Version int    `json:"v"`
}

type serverTimeResponse struct {
	ServerTime int64 `json:"serverTime"`
}

func FetchTokenFromCookie(spDc string, spKey ...string) (InternalToken, error) {
	spDc = strings.TrimSpace(spDc)
	spDc = strings.TrimPrefix(spDc, "sp_dc=")
	if spDc == "" {
		return InternalToken{}, fmt.Errorf("Spotify login cookie is missing")
	}
	key := ""
	if len(spKey) > 0 {
		key = strings.TrimSpace(strings.TrimPrefix(spKey[0], "sp_key="))
	}
	client := &http.Client{Timeout: 15 * time.Second}
	secret, version, err := fetchNuance(client)
	if err != nil {
		return InternalToken{}, err
	}
	serverTime, err := fetchServerTime(client)
	if err != nil {
		return InternalToken{}, err
	}
	totp, err := generateTotp(secret, serverTime)
	if err != nil {
		return InternalToken{}, err
	}
	endpoint := fmt.Sprintf("%s?reason=transport&productType=web-player&totp=%s&totpServer=%s&totpVer=%d", tokenURL, totp, totp, version)
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return InternalToken{}, err
	}
	req.Header.Set("User-Agent", webUserAgent)
	req.Header.Set("Accept", "application/json")
	cookie := "sp_dc=" + spDc
	if key != "" {
		cookie += "; sp_key=" + key
	}
	req.Header.Set("Cookie", cookie)
	resp, err := client.Do(req)
	if err != nil {
		return InternalToken{}, fmt.Errorf("Spotify token request failed")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return InternalToken{}, fmt.Errorf("Spotify token response could not be read")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return InternalToken{}, fmt.Errorf("Spotify login was rejected")
	}
	var token InternalToken
	if err := json.Unmarshal(body, &token); err != nil {
		return InternalToken{}, fmt.Errorf("Spotify token response was invalid")
	}
	if token.IsAnonymous || strings.TrimSpace(token.AccessToken) == "" {
		return InternalToken{}, fmt.Errorf("Spotify login expired or invalid")
	}
	return token, nil
}

func fetchNuance(client *http.Client) (string, int, error) {
	req, err := http.NewRequest(http.MethodGet, nuanceGistURL, nil)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("User-Agent", webUserAgent)
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, fmt.Errorf("Spotify login helpers unavailable")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", 0, fmt.Errorf("Spotify login helpers unavailable")
	}
	var items []nuance
	if err := json.Unmarshal(body, &items); err != nil || len(items) == 0 {
		return "", 0, fmt.Errorf("Spotify login helpers unavailable")
	}
	best := items[0]
	for _, item := range items[1:] {
		if item.Version > best.Version {
			best = item
		}
	}
	if strings.TrimSpace(best.Secret) == "" {
		return "", 0, fmt.Errorf("Spotify login helpers unavailable")
	}
	return best.Secret, best.Version, nil
}

func fetchServerTime(client *http.Client) (int64, error) {
	req, err := http.NewRequest(http.MethodGet, serverTimeURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", webUserAgent)
	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("Spotify time sync failed")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return 0, fmt.Errorf("Spotify time sync failed")
	}
	var payload serverTimeResponse
	if err := json.Unmarshal(body, &payload); err != nil || payload.ServerTime <= 0 {
		return 0, fmt.Errorf("Spotify time sync failed")
	}
	return payload.ServerTime, nil
}

func generateTotp(secret string, serverTimeSec int64) (string, error) {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		key, err = base32.StdEncoding.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
		if err != nil {
			return "", fmt.Errorf("Spotify login helpers unavailable")
		}
	}
	counter := uint64(math.Floor(float64(serverTimeSec) / 30))
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(buf[:])
	hash := mac.Sum(nil)
	offset := hash[len(hash)-1] & 0x0f
	code := (int(hash[offset]&0x7f) << 24) | (int(hash[offset+1]&0xff) << 16) | (int(hash[offset+2]&0xff) << 8) | int(hash[offset+3]&0xff)
	return fmt.Sprintf("%06d", code%1_000_000), nil
}
