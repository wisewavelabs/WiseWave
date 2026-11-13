package native

import (
	"fmt"
	"html"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"wisewave-runtime/desktop"
)

const (
	spotifyLoginURL     = "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F"
	spotifyChromeUA     = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
	spotifyLoadingBase  = "https://wisewave.internal/spotify-login/"
	spotifyLinkingLabel = "Bringing your music over"
	spotifyLegacyStore  = "spotify-login"
)

func spotifyStatusHTML(title, label string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>%s</title>
  <style>
    body {
      background-color: #121212;
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      color: #b3b3b3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      overflow: hidden;
      user-select: none;
    }

    .loading-container {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }

    .spinner {
      position: relative;
      width: 48px;
      height: 48px;
    }

    .spinner-inner {
      box-sizing: border-box;
      display: block;
      position: absolute;
      width: 40px;
      height: 40px;
      margin: 4px;
      border: 3px solid transparent;
      border-radius: 50%%;
      animation: spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
      border-top-color: #1db954;
    }

    .spinner-inner:nth-child(1) { animation-delay: -0.45s; }
    .spinner-inner:nth-child(2) { animation-delay: -0.3s; }
    .spinner-inner:nth-child(3) { animation-delay: -0.15s; }

    @keyframes spin {
      0%% { transform: rotate(0deg); }
      100%% { transform: rotate(360deg); }
    }

    .shimmer-text {
      font-size: 17px;
      line-height: 22px;
      font-weight: 500;
      color: transparent;
      -webkit-text-fill-color: transparent;
      background: linear-gradient(
        90deg,
        #a1a1a1 0%%,
        #a1a1a1 30%%,
        rgba(161, 161, 161, 0.45) 45%%,
        rgba(161, 161, 161, 0.45) 55%%,
        #a1a1a1 70%%,
        #a1a1a1 100%%
      );
      background-size: 300%% 100%%;
      -webkit-background-clip: text;
      background-clip: text;
      animation: label-shine 2.25s cubic-bezier(0.25, 0.1, 0.25, 1) infinite;
    }

    @keyframes label-shine {
      0%%, 18%% { background-position: 100%% 0; }
      82%%, 100%% { background-position: 0%% 0; }
    }

    .shimmer-text::after {
      content: "...";
      display: inline-block;
      width: 0ch;
      overflow: hidden;
      text-align: left;
      vertical-align: bottom;
      animation: dots 1.6s steps(4, end) infinite;
    }

    @keyframes dots {
      to { width: 3ch; }
    }
  </style>
</head>
<body>
  <div class="loading-container" role="status" aria-live="polite">
    <div class="spinner" aria-hidden="true">
      <div class="spinner-inner"></div>
      <div class="spinner-inner"></div>
      <div class="spinner-inner"></div>
    </div>
    <div class="shimmer-text">%s</div>
  </div>
</body>
</html>`, html.EscapeString(title), html.EscapeString(label))
}

type SpotifyLogin struct {
	account *desktop.SpotifyAccount

	mu        sync.Mutex
	window    *mygo.Window
	session   *mygo.Session
	stop      chan struct{}
	busy      bool
	closing   bool
	gen       uint64
	capturing bool
	armed     bool
	linkedDC  string
	linkedGen uint64
	completed bool
}

func NewSpotifyLogin(account *desktop.SpotifyAccount) *SpotifyLogin {
	return &SpotifyLogin{account: account}
}

func (s *SpotifyLogin) Busy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.busy
}

func (s *SpotifyLogin) Start() error {
	s.mu.Lock()
	if s.busy {
		window := s.window
		s.mu.Unlock()
		if window != nil && !window.IsDestroyed() {
			window.Show()
			window.Focus()
		}
		return nil
	}

	s.busy = true
	s.closing = false
	s.capturing = false
	s.armed = false
	s.linkedDC = ""
	s.linkedGen = 0
	s.completed = false
	s.gen++
	gen := s.gen
	session := mygo.NewEphemeralSession()
	s.session = session
	stop := make(chan struct{})
	s.stop = stop
	window := mygo.NewWindow(mygo.WindowOptions{
		Title:           "Link Spotify",
		Width:           480,
		Height:          700,
		MinWidth:        420,
		MinHeight:       600,
		MaxWidth:        560,
		MaxHeight:       820,
		DisableMaximize: true,
		URL:             spotifyLoginURL,
		BackgroundColor: "#121212",
		Page: mygo.PageOptions{
			Session:   session,
			UserAgent: spotifyChromeUA,
		},
	})
	s.window = window
	s.mu.Unlock()

	window.OnClosed(func() {
		s.finish(gen)
	})
	window.Page().OnDidFailLoad(func(err *mygo.LoadError) {
		if err == nil {
			return
		}
		log.Printf("spotify login load failed: %s (%s)", err.URL, err.Description)
	})
	window.Page().OnDidNavigate(func(raw string) {
		if !spotifyPostLoginURL(raw) {
			return
		}
		go func() {
			if readSpotifyCookie(session, "sp_dc") != "" {
				s.completeLogin(gen, session)
			}
		}()
	})
	window.Page().SetWindowOpenHandler(func(req mygo.WindowOpenRequest) *mygo.WindowOptions {
		return nil
	})

	go s.poll(gen, session, stop)
	return nil
}

func (s *SpotifyLogin) Cancel() error {
	s.mu.Lock()
	window := s.window
	pendingDC, pendingGen := s.shutdownLocked()
	s.mu.Unlock()
	s.disconnectPending(pendingDC, pendingGen)
	if window != nil && !window.IsDestroyed() {
		window.Close()
	}
	return nil
}

func (s *SpotifyLogin) Logout() error {
	s.mu.Lock()
	window := s.window
	session := s.session
	_, _ = s.shutdownLocked()
	s.mu.Unlock()
	if window != nil && !window.IsDestroyed() {
		window.Close()
	}
	if session != nil {
		clearSpotifySession(session)
	}
	clearSpotifySession(mygo.NewSession(spotifyLegacyStore))
	if s.account != nil {
		return s.account.Disconnect()
	}
	return nil
}

func clearSpotifySession(session *mygo.Session) {
	if session == nil {
		return
	}
	filters := []mygo.CookieFilter{
		{Domain: "spotify.com"},
		{Domain: ".spotify.com"},
		{Domain: "accounts.spotify.com"},
		{Domain: ".accounts.spotify.com"},
		{Domain: "open.spotify.com"},
		{URL: "https://open.spotify.com/"},
		{URL: "https://accounts.spotify.com/"},
		{Name: "sp_dc"},
		{Name: "sp_key"},
	}
	seen := map[string]bool{}
	for _, filter := range filters {
		list, err := session.Cookies.List(filter)
		if err != nil {
			continue
		}
		for _, cookie := range list {
			key := strings.ToLower(cookie.Name) + "\n" + strings.ToLower(cookie.Domain) + "\n" + cookie.Path
			if seen[key] {
				continue
			}
			seen[key] = true
			if err := session.Cookies.Delete(cookie); err != nil {
				log.Printf("spotify logout: could not delete cookie %s: %v", cookie.Name, err)
			}
		}
	}
	if err := session.ClearData(mygo.SiteDataAll); err != nil {
		log.Printf("spotify logout: could not clear session data: %v", err)
	}
}

func (s *SpotifyLogin) completeLogin(gen uint64, session *mygo.Session) {
	s.mu.Lock()
	if !s.busy || s.closing || s.gen != gen || s.armed {
		s.mu.Unlock()
		return
	}
	s.armed = true
	window := s.window
	s.mu.Unlock()

	if window != nil && !window.IsDestroyed() {
		window.Page().LoadHTML(spotifyStatusHTML("Linking Spotify", spotifyLinkingLabel), spotifyLoadingBase)
		window.SetTitle("Linking Spotify")
	}

	go func() {
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			if s.tryCapture(gen, session) {
				return
			}
			time.Sleep(250 * time.Millisecond)
		}
		log.Printf("spotify login: cookie was not ready after redirect")
		s.mu.Lock()
		if s.gen != gen || s.closing || !s.busy {
			s.mu.Unlock()
			return
		}
		s.armed = false
		window := s.window
		s.mu.Unlock()
		if window != nil && !window.IsDestroyed() {
			window.SetTitle("Link Spotify")
			if err := window.Page().LoadURL(spotifyLoginURL); err != nil {
				log.Printf("spotify login reload failed: %v", err)
			}
		}
	}()
}

func (s *SpotifyLogin) poll(gen uint64, session *mygo.Session, stop <-chan struct{}) {
	ticker := time.NewTicker(750 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			s.mu.Lock()
			alive := s.busy && !s.closing && s.gen == gen
			armed := s.armed
			s.mu.Unlock()
			if !alive {
				continue
			}
			if !armed {
				if readSpotifyCookie(session, "sp_dc") == "" {
					continue
				}
				s.completeLogin(gen, session)
				continue
			}
		}
	}
}

func (s *SpotifyLogin) tryCapture(gen uint64, session *mygo.Session) bool {
	s.mu.Lock()
	if !s.busy || s.closing || s.gen != gen || !s.armed || s.capturing || s.account == nil || session == nil {
		s.mu.Unlock()
		return false
	}
	s.capturing = true
	account := s.account
	s.mu.Unlock()

	spDc := readSpotifyCookie(session, "sp_dc")
	if spDc == "" {
		s.mu.Lock()
		if s.gen == gen {
			s.capturing = false
		}
		s.mu.Unlock()
		return false
	}
	spKey := readSpotifyCookie(session, "sp_key")

	connection, err := account.ConnectForLogin(spDc, spKey)
	if err != nil {
		s.mu.Lock()
		if s.gen == gen {
			s.capturing = false
		}
		s.mu.Unlock()
		log.Printf("spotify login connect failed: %v", err)
		return false
	}
	accountGen := connection.Generation
	s.mu.Lock()
	if !s.busy || s.closing || s.gen != gen {
		s.mu.Unlock()
		account.DisconnectIf(spDc, accountGen)
		return true
	}
	s.linkedDC = spDc
	s.linkedGen = accountGen
	s.mu.Unlock()

	_, syncErr := account.SyncLibrary()
	if syncErr != nil {
		log.Printf("spotify library sync failed: %v", syncErr)
	}

	s.mu.Lock()
	if !s.busy || s.closing || s.gen != gen {
		s.mu.Unlock()
		account.DisconnectIf(spDc, accountGen)
		return true
	}
	s.capturing = false
	s.completed = true
	s.mu.Unlock()

	time.Sleep(450 * time.Millisecond)
	s.closeWindow(gen)
	s.finish(gen)
	return true
}

func (s *SpotifyLogin) closeWindow(gen uint64) {
	s.mu.Lock()
	window := s.window
	if s.gen != gen {
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	if window != nil && !window.IsDestroyed() {
		window.Close()
	}
}

func (s *SpotifyLogin) finish(gen uint64) {
	s.mu.Lock()
	if s.gen != gen {
		s.mu.Unlock()
		return
	}
	pendingDC, pendingGen := s.shutdownLocked()
	s.mu.Unlock()
	s.disconnectPending(pendingDC, pendingGen)
}

func (s *SpotifyLogin) shutdownLocked() (string, uint64) {
	pendingDC := ""
	pendingGen := uint64(0)
	if !s.completed {
		pendingDC = s.linkedDC
		pendingGen = s.linkedGen
	}
	s.closing = true
	s.busy = false
	s.capturing = false
	s.armed = false
	s.linkedDC = ""
	s.linkedGen = 0
	s.completed = false
	if s.stop != nil {
		select {
		case <-s.stop:
		default:
			close(s.stop)
		}
		s.stop = nil
	}
	s.window = nil
	s.session = nil
	return pendingDC, pendingGen
}

func (s *SpotifyLogin) disconnectPending(spDc string, generation uint64) {
	if s.account == nil || strings.TrimSpace(spDc) == "" {
		return
	}
	if s.account.DisconnectIf(spDc, generation) {
		log.Printf("spotify login cancelled before it finished")
	}
}

func spotifyPostLoginURL(raw string) bool {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" || strings.Contains(raw, "wisewave.internal") || strings.HasPrefix(raw, "about:") {
		return false
	}
	if strings.Contains(raw, "accounts.spotify.com/login/ok") {
		return true
	}
	if strings.Contains(raw, "accounts.spotify.com/login") {
		return false
	}
	if strings.Contains(raw, "open.spotify.com") {
		return true
	}
	return strings.Contains(raw, "accounts.spotify.com") && strings.Contains(raw, "/status")
}

func readSpotifyCookie(session *mygo.Session, name string) string {
	filters := []mygo.CookieFilter{
		{Name: name, URL: "https://open.spotify.com/"},
		{Name: name, Domain: "spotify.com"},
		{Name: name, Domain: ".spotify.com"},
		{Name: name, Domain: "accounts.spotify.com"},
		{Name: name, URL: "https://accounts.spotify.com/"},
	}
	for _, filter := range filters {
		list, err := session.Cookies.List(filter)
		if err != nil {
			continue
		}
		for _, cookie := range list {
			if strings.EqualFold(cookie.Name, name) && strings.TrimSpace(cookie.Value) != "" {
				return strings.TrimSpace(cookie.Value)
			}
		}
	}
	return ""
}
