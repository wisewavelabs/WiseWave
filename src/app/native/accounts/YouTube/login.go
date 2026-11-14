package youtube

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	youtubeaccount "wisewave-runtime/desktop/accounts/YouTube"
	"wisewave/src/app/native/accounts/presentation"
)

const youtubeLoginURL = "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com%2F"

type YouTubeLoginStatus struct {
	Busy  bool   `json:"busy"`
	Error string `json:"error"`
}

type youtubePageSession struct {
	Ready        bool   `json:"ready"`
	Visitor      string `json:"visitor"`
	DataSyncID   string `json:"data_sync_id"`
	AccountIndex int    `json:"account_index"`
	PageID       string `json:"page_id"`
}

type YouTubeLogin struct {
	mu         sync.Mutex
	account    *youtubeaccount.YouTubeAccount
	window     *mygo.Window
	cancel     context.CancelFunc
	generation uint64
	busy       bool
	failure    string
	phase      string
}

func NewYouTubeLogin(account *youtubeaccount.YouTubeAccount) *YouTubeLogin {
	return &YouTubeLogin{account: account}
}

func (s *YouTubeLogin) Status() YouTubeLoginStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return YouTubeLoginStatus{s.busy, s.failure}
}

func (s *YouTubeLogin) Start() error {
	s.mu.Lock()
	if s.busy {
		window := s.window
		s.mu.Unlock()
		if window != nil && !window.IsDestroyed() && !youtubeIntermediatePage(window.Page().URL()) {
			window.Show()
			window.Focus()
		}
		return nil
	}
	if s.account == nil {
		s.mu.Unlock()
		return errors.New("YouTube account is unavailable")
	}
	s.generation++
	generation := s.generation
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	s.cancel = cancel
	s.busy = true
	s.failure = ""
	s.phase = ""
	session := mygo.NewEphemeralSession()
	options := presentation.WindowOptions("Link YouTube Music", "about:blank", "#121212", session)
	options.Hidden = true
	options.Page.BackgroundThrottling = mygo.ThrottlingOff
	window := mygo.NewWindow(options)
	s.window = window
	s.mu.Unlock()
	window.OnClosed(func() { s.finish(generation, "") })
	window.Page().OnWillNavigate(func(event *mygo.NavigateEvent) {
		if youtubeIntermediatePage(event.URL) || youtubeLoadingPage(event.URL) {
			window.Hide()
		}
		if !youtubeLoginNavigation(event.URL) {
			if parsed, err := url.Parse(event.URL); err == nil && mygo.IsDev() {
				log.Printf("youtube login: blocked navigation host=%s", parsed.Hostname())
			}
			s.mu.Lock()
			if s.generation == generation && s.busy {
				s.failure = "Google could not finish redirecting to YouTube Music. Cancel and try signing in again."
			}
			s.mu.Unlock()
			event.PreventDefault()
		}
	})
	window.Page().OnDidFinishLoad(func() {
		address := window.Page().URL()
		if youtubeIntermediatePage(address) || !youtubeLoginNavigation(address) {
			return
		}
		s.mu.Lock()
		active := s.generation == generation && s.busy
		s.mu.Unlock()
		if active && !window.IsDestroyed() {
			window.Show()
		}
	})
	window.Page().SetWindowOpenHandler(func(request mygo.WindowOpenRequest) *mygo.WindowOptions { return nil })
	if err := window.Page().LoadURL(youtubeLoginURL); err != nil {
		s.finish(generation, "YouTube sign-in could not be opened")
		window.Close()
		return errors.New("YouTube sign-in could not be opened")
	}
	go s.poll(ctx, generation, window, session)
	return nil
}

func youtubeLoginNavigation(raw string) bool {
	if raw == "about:blank" {
		return true
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || (parsed.Port() != "" && parsed.Port() != "443") {
		return false
	}
	switch strings.ToLower(parsed.Hostname()) {
	case "accounts.google.com", "www.google.com", "google.com", "accounts.google.co.in", "www.google.co.in", "google.co.in", "accounts.youtube.com", "music.youtube.com", "www.youtube.com", "myaccount.google.com", "consent.google.com", "consent.youtube.com":
		return true
	case "wisewave.internal":
		return parsed.Path == "/youtube-login/"
	}
	return false
}

func (s *YouTubeLogin) poll(ctx context.Context, generation uint64, window *mygo.Window, session *mygo.Session) {
	defer session.ClearData(mygo.SiteDataAll)
	ticker := time.NewTicker(750 * time.Millisecond)
	defer ticker.Stop()
	lastCookie := ""
	verificationStarted := time.Time{}
	nextAttempt := time.Time{}
	for {
		select {
		case <-ctx.Done():
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				s.finish(generation, "YouTube sign-in timed out. Please try again.")
				if !window.IsDestroyed() {
					window.Close()
				}
			}
			return
		case <-ticker.C:
			if window.IsDestroyed() {
				return
			}
			if !youtubeMusicPage(window.Page().URL()) {
				s.setPhase(generation, "waiting for Google redirect")
				verificationStarted = time.Time{}
				continue
			}
			identityCtx, identityCancel := context.WithTimeout(ctx, 3*time.Second)
			identity := youtubePageIdentity(identityCtx, window)
			identityCancel()
			if !identity.Ready {
				s.setPhase(generation, "waiting for YouTube page")
				s.clearPendingFailure(generation)
				continue
			}
			cookie := youtubeSessionCookie(session)
			if cookie == "" {
				s.setPhase(generation, "waiting for YouTube session cookies")
				continue
			}
			if cookie == lastCookie && time.Now().Before(nextAttempt) {
				continue
			}
			if verificationStarted.IsZero() {
				verificationStarted = time.Now()
			}
			s.setPhase(generation, "verifying account with YouTube")
			captureCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
			prepared, err := youtubeaccount.ValidateYouTubeLogin(captureCtx, cookie, identity.Visitor, identity.DataSyncID, youtubeaccount.YouTubeIdentity{AccountIndex: identity.AccountIndex, PageID: identity.PageID})
			cancel()
			if ctx.Err() != nil {
				continue
			}
			if !youtubeMusicPage(window.Page().URL()) {
				s.clearPendingFailure(generation)
				continue
			}
			lastCookie = cookie
			nextAttempt = time.Now().Add(5 * time.Second)
			if err != nil {
				s.setPhase(generation, "account verification pending")
				s.mu.Lock()
				if s.generation == generation && s.busy {
					if errors.Is(err, youtubeaccount.ErrYouTubeNotSignedIn) {
						if time.Since(verificationStarted) > 30*time.Second {
							s.failure = "YouTube has not confirmed this session yet. Please retry sign-in."
						} else {
							s.failure = ""
						}
					} else {
						s.failure = err.Error()
					}
				}
				s.mu.Unlock()
				continue
			}
			s.mu.Lock()
			if s.generation != generation || !s.busy || ctx.Err() != nil {
				s.mu.Unlock()
				return
			}
			if err := youtubeaccount.SaveYouTubeLogin(s.account, prepared); err != nil {
				s.failure = err.Error()
				s.mu.Unlock()
				continue
			}
			s.failure = ""
			s.mu.Unlock()
			s.setPhase(generation, "loading YouTube library")
			if !window.IsDestroyed() {
				window.SetTitle("Linking YouTube Music")
				window.Page().LoadHTML(presentation.StatusHTML("Linking YouTube Music", "Bringing your music over", "#ff0033"), "https://wisewave.internal/youtube-login/")
			}
			_ = youtubeaccount.YouTubeAccountChanged.Broadcast(true)
			_, syncErr := s.account.SyncLibrary()
			if syncErr == nil {
				waiting := time.NewTicker(250 * time.Millisecond)
				for s.account.SyncStatus().Phase == "syncing" && ctx.Err() == nil {
					select {
					case <-ctx.Done():
					case <-waiting.C:
					}
				}
				waiting.Stop()
			}
			s.mu.Lock()
			if s.generation != generation {
				s.mu.Unlock()
				return
			}
			if ctx.Err() != nil {
				s.mu.Unlock()
				s.account.CancelSync()
				failure := ""
				if errors.Is(ctx.Err(), context.DeadlineExceeded) {
					failure = "YouTube sign-in timed out. Please try again."
				}
				s.finish(generation, failure)
				if !window.IsDestroyed() {
					window.Close()
				}
				return
			}
			s.busy = false
			s.window = nil
			if s.cancel != nil {
				s.cancel()
				s.cancel = nil
			}
			s.mu.Unlock()
			if !window.IsDestroyed() {
				window.Close()
			}

			return
		}
	}
}

func youtubeSessionCookie(session *mygo.Session) string {
	cookies, err := session.Cookies.List(mygo.CookieFilter{URL: "https://music.youtube.com/"})
	if err != nil {
		return ""
	}
	values := make(map[string]string)
	for _, cookie := range cookies {
		domain := strings.TrimPrefix(strings.ToLower(cookie.Domain), ".")
		if domain != "youtube.com" && domain != "music.youtube.com" {
			continue
		}
		if cookie.Value == "" || strings.ContainsAny(cookie.Name+cookie.Value, ";\r\n\x00") {
			continue
		}
		if !cookie.Expires.IsZero() && time.Now().After(cookie.Expires) {
			continue
		}
		values[cookie.Name] = cookie.Value
	}
	if strings.TrimSpace(values["SAPISID"]) == "" {
		return ""
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+values[key])
	}
	return strings.Join(parts, "; ")
}

func youtubeMusicPage(raw string) bool {
	parsed, err := url.Parse(raw)
	return err == nil && parsed.Scheme == "https" && parsed.User == nil && parsed.Hostname() == "music.youtube.com" && (parsed.Port() == "" || parsed.Port() == "443")
}

func youtubeLoadingPage(raw string) bool {
	parsed, err := url.Parse(raw)
	return err == nil && parsed.Scheme == "https" && parsed.Host == "wisewave.internal" && parsed.Path == "/youtube-login/"
}

func youtubeIntermediatePage(raw string) bool {
	if raw == "about:blank" {
		return true
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	switch parsed.Hostname() {
	case "music.youtube.com", "www.youtube.com", "youtube.com", "accounts.youtube.com":
		return true
	case "accounts.google.com", "accounts.google.co.in", "www.google.com", "www.google.co.in":
		return strings.HasPrefix(parsed.Path, "/accounts/SetSID") || strings.HasPrefix(parsed.Path, "/accounts/CheckCookie")
	}
	return false
}

func (s *YouTubeLogin) clearPendingFailure(generation uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.generation == generation && s.busy {
		s.failure = ""
	}
}

func (s *YouTubeLogin) setPhase(generation uint64, phase string) {
	s.mu.Lock()
	changed := s.generation == generation && s.busy && s.phase != phase
	if changed {
		s.phase = phase
	}
	s.mu.Unlock()
	if changed && mygo.IsDev() {
		log.Printf("youtube login: %s", phase)
	}
}

func youtubePageIdentity(ctx context.Context, window *mygo.Window) youtubePageSession {
	value, err := window.Page().EvalContext(ctx, `if (location.protocol !== "https:" || location.hostname !== "music.youtube.com" || document.readyState === "loading") return {ready:false}; const config = window.ytcfg; const legacy = window.yt && window.yt.config_; const read = key => config && typeof config.get === "function" ? config.get(key) : legacy && legacy[key]; const index = Number(read("SESSION_INDEX") || 0); return {ready:true, visitor:String(read("VISITOR_DATA") || ""), data_sync_id:String(read("DATASYNC_ID") || ""), account_index:Number.isInteger(index) && index >= 0 && index < 100 ? index : 0, page_id:String(read("DELEGATED_SESSION_ID") || "")};`)
	if err != nil {
		return youtubePageSession{}
	}
	data, err := json.Marshal(value)
	if err != nil {
		return youtubePageSession{}
	}
	var result youtubePageSession
	if json.Unmarshal(data, &result) != nil {
		return youtubePageSession{}
	}
	return result
}

func (s *YouTubeLogin) finish(generation uint64, failure string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if generation != s.generation {
		return
	}
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	s.busy = false
	s.window = nil
	if failure != "" {
		s.failure = failure
	}
}

func (s *YouTubeLogin) Cancel() error {
	s.mu.Lock()
	window := s.window
	s.generation++
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	s.busy = false
	s.failure = ""
	s.window = nil
	s.mu.Unlock()
	s.account.CancelSync()
	if window != nil && !window.IsDestroyed() {
		window.Close()
	}
	return nil
}

func (s *YouTubeLogin) Logout() error { _ = s.Cancel(); return s.account.Disconnect() }
