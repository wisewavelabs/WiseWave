package tokens

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

//go:embed po_token.html
var tokenHTML string

const tokenKey = "O43z0dpjhgX20SCx4KAo"
const tokenAPIKey = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw"

type Engine struct {
	mu      sync.Mutex
	window  *mygo.Window
	ready   chan struct{}
	expires time.Time
	visitor string
	session string
	client  *http.Client
}

func New() *Engine {
	w := mygo.NewWindow(mygo.WindowOptions{
		Title:       "Runtime",
		Hidden:      true,
		SkipTaskbar: true,
		Page:        mygo.PageOptions{Untrusted: true, Session: mygo.NewEphemeralSession()},
	})
	engine := &Engine{window: w, ready: make(chan struct{}), client: &http.Client{Timeout: 12 * time.Second}}
	var once sync.Once
	w.Page().OnDOMReady(func() { once.Do(func() { close(engine.ready) }) })
	w.Page().LoadHTML(tokenHTML, "https://wisewave.internal/")
	return engine
}

func (e *Engine) post(ctx context.Context, method string, data any) ([]byte, error) {
	body, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://www.youtube.com/api/jnn/v1/"+method, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json+protobuf")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Goog-Api-Key", tokenAPIKey)
	req.Header.Set("X-User-Agent", "grpc-web-javascript/0.1")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36")
	res, err := e.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token service %s: HTTP %d", method, res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, 4<<20))
}

func decodeTokenBase64(value string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(strings.TrimRight(strings.NewReplacer("+", "-", "/", "_", ".", "=").Replace(value), "="))
}

func parseChallenge(data []byte) (map[string]any, error) {
	var outer []json.RawMessage
	if err := json.Unmarshal(data, &outer); err != nil || len(outer) == 0 {
		return nil, errors.New("invalid token challenge")
	}
	var challenge []json.RawMessage
	if len(outer) > 1 {
		var encoded string
		if json.Unmarshal(outer[1], &encoded) == nil && encoded != "" {
			decoded, err := decodeTokenBase64(encoded)
			if err != nil {
				return nil, err
			}
			for i := range decoded {
				decoded[i] += 97
			}
			if err := json.Unmarshal(decoded, &challenge); err != nil {
				return nil, err
			}
		}
	}
	if len(challenge) == 0 {
		if err := json.Unmarshal(outer[0], &challenge); err != nil {
			return nil, err
		}
	}
	if len(challenge) < 6 {
		return nil, errors.New("incomplete token challenge")
	}
	var program, name string
	if json.Unmarshal(challenge[4], &program) != nil || json.Unmarshal(challenge[5], &name) != nil || program == "" || name == "" {
		return nil, errors.New("invalid token challenge fields")
	}
	var scripts []any
	_ = json.Unmarshal(challenge[1], &scripts)
	var interpreter string
	for _, value := range scripts {
		if text, ok := value.(string); ok && text != "" {
			interpreter = text
			break
		}
	}
	if interpreter == "" {
		return nil, errors.New("token challenge interpreter missing")
	}
	return map[string]any{"program": program, "globalName": name, "interpreterJavascript": map[string]string{"privateDoNotAccessOrElseSafeScriptWrappedValue": interpreter}}, nil
}

func (e *Engine) initialize(ctx context.Context) error {
	select {
	case <-e.ready:
	case <-ctx.Done():
		return ctx.Err()
	}
	data, err := e.post(ctx, "Create", []string{tokenKey})
	if err != nil {
		return err
	}
	challenge, err := parseChallenge(data)
	if err != nil {
		return err
	}
	script, err := json.Marshal(challenge)
	if err != nil {
		return err
	}
	value, err := e.window.Page().EvalContext(ctx, "return runBotGuard("+string(script)+").then(r => { window.tokenSignals = r.webPoSignalOutput; return r.botguardResponse; })")
	if err != nil {
		return err
	}
	snapshot, ok := value.(string)
	if !ok || snapshot == "" {
		return errors.New("token challenge returned no snapshot")
	}
	data, err = e.post(ctx, "GenerateIT", []string{tokenKey, snapshot})
	if err != nil {
		return err
	}
	var response []json.RawMessage
	if err := json.Unmarshal(data, &response); err != nil || len(response) < 2 {
		return errors.New("invalid integrity response")
	}
	var encoded string
	var lifetime int64
	if json.Unmarshal(response[0], &encoded) != nil || json.Unmarshal(response[1], &lifetime) != nil || lifetime <= 0 {
		return errors.New("invalid integrity token")
	}
	token, err := decodeTokenBase64(encoded)
	if err != nil {
		return err
	}
	bytesJSON, err := json.Marshal(bytesToInts(token))
	if err != nil {
		return err
	}
	_, err = e.window.Page().EvalContext(ctx, "return createPoTokenMinter(window.tokenSignals, new Uint8Array("+string(bytesJSON)+"))")
	if err != nil {
		return err
	}
	e.expires = time.Now().Add(time.Duration(max(1, lifetime-300)) * time.Second)
	e.visitor, e.session = "", ""
	return nil
}

func bytesToInts(data []byte) []int {
	out := make([]int, len(data))
	for i, b := range data {
		out[i] = int(b)
	}
	return out
}

func (e *Engine) mint(ctx context.Context, identifier string) (string, error) {
	data, err := json.Marshal(identifier)
	if err != nil {
		return "", err
	}
	value, err := e.window.Page().EvalContext(ctx, "return obtainPoToken(new TextEncoder().encode("+string(data)+")).then(v => Array.from(v))")
	if err != nil {
		return "", err
	}
	numbers, ok := value.([]any)
	if !ok || len(numbers) == 0 {
		return "", errors.New("empty token")
	}
	raw := make([]byte, len(numbers))
	for i, number := range numbers {
		n, ok := number.(float64)
		if !ok || n < 0 || n > 255 || n != float64(byte(n)) {
			return "", errors.New("invalid token byte")
		}
		raw[i] = byte(n)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func (e *Engine) Tokens(ctx context.Context, videoID, visitor string) (string, string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if visitor == "" {
		return "", "", errors.New("visitor data unavailable")
	}
	if time.Now().After(e.expires) {
		if err := e.initialize(ctx); err != nil {
			return "", "", err
		}
	}
	if e.visitor != visitor || e.session == "" {
		token, err := e.mint(ctx, visitor)
		if err != nil {
			e.expires = time.Time{}
			return "", "", err
		}
		e.visitor, e.session = visitor, token
	}
	token, err := e.mint(ctx, videoID)
	if err != nil {
		e.expires = time.Time{}
		return "", "", err
	}
	return token, e.session, nil
}
