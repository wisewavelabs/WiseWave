package spotify

import (
	"log"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	spotifyaccount "wisewave-runtime/desktop/accounts/Spotify"
	"wisewave/src/app/native/accounts/presentation"
)

const (
	spotifyLoginURL     = "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F"
	spotifyChromeUA     = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
	spotifyLoadingBase  = "https://wisewave.internal/spotify-login/"
	spotifyLinkingLabel = "Bringing your music over"
	spotifyLegacyStore  = "spotify-login"
)

type SpotifyLogin struct {
	account *spotifyaccount.SpotifyAccount

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

func NewSpotifyLogin(account *spotifyaccount.SpotifyAccount) *SpotifyLogin {
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
	options := presentation.WindowOptions("Link Spotify", spotifyLoginURL, "#121212", session)
	options.Page.UserAgent = spotifyChromeUA
	window := mygo.NewWindow(options)
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
		window.Page().LoadHTML(presentation.StatusHTML("Linking Spotify", spotifyLinkingLabel, "#1db954"), spotifyLoadingBase)
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
