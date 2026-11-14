package windows

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/egoist/mygo"
)

var TrayAction = mygo.NewEvent[string]("tray-action")
var PlayerFullscreenChanged = mygo.NewEvent[bool]("player-fullscreen-changed")

type TrayState struct {
	HasTrack bool `json:"hasTrack"`
	Playing  bool `json:"playing"`
	HasNext  bool `json:"hasNext"`
	Muted    bool `json:"muted"`
}

type TrayControl struct {
	mu                 sync.RWMutex
	startupMu          sync.Mutex
	state              TrayState
	window             *mygo.Window
	tray               *mygo.Tray
	quitting           atomic.Bool
	minimizeToTray     atomic.Bool
	miniWhenMinimized  atomic.Bool
	autoMini           atomic.Bool
	playerFullscreen   bool
	previousFullscreen bool
}

func (tray *TrayControl) SetWindowPreferences(minimizeToTray, miniWhenMinimized bool) {
	tray.minimizeToTray.Store(minimizeToTray)
	tray.miniWhenMinimized.Store(miniWhenMinimized)
}

func (tray *TrayControl) StartupEnabled() bool { return mygo.App.OpenAtLogin() }

func (tray *TrayControl) SetStartup(enabled bool) error {
	if mygo.IsDev() {
		return errors.New("Launch at startup is available in the installed app")
	}
	return mygo.App.SetOpenAtLogin(enabled)
}

func startupModeFile() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "WiseWave", "startup-mode"), nil
}

func startupMinimized() bool {
	path, err := startupModeFile()
	if err != nil {
		return false
	}
	data, err := os.ReadFile(path)
	return err == nil && string(data) == "Minimized"
}

func (tray *TrayControl) StartupMode() string {
	tray.startupMu.Lock()
	defer tray.startupMu.Unlock()
	if !mygo.App.OpenAtLogin() {
		return "No"
	}
	if startupMinimized() {
		return "Minimized"
	}
	return "Yes"
}

func (tray *TrayControl) SetStartupMode(mode string) error {
	tray.startupMu.Lock()
	defer tray.startupMu.Unlock()
	if mode != "No" && mode != "Yes" && mode != "Minimized" {
		return errors.New("Invalid startup mode")
	}
	if mygo.IsDev() {
		return errors.New("Launch at startup is available in the installed app")
	}
	path, err := startupModeFile()
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".startup-*")
	if err != nil {
		return err
	}
	temp := file.Name()
	defer os.Remove(temp)
	if _, err = file.WriteString(mode); err != nil {
		_ = file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	previous := mygo.App.OpenAtLogin()
	if err = mygo.App.SetOpenAtLogin(mode != "No"); err != nil {
		return err
	}
	if err = os.Rename(temp, path); err != nil {
		if rollback := mygo.App.SetOpenAtLogin(previous); rollback != nil {
			return errors.Join(err, rollback)
		}
		return err
	}
	return nil
}

func (tray *TrayControl) Update(state TrayState) {
	tray.mu.Lock()
	tray.state = state
	tray.mu.Unlock()
}

func (tray *TrayControl) State() TrayState {
	tray.mu.RLock()
	defer tray.mu.RUnlock()
	return tray.state
}

func (tray *TrayControl) SetPlayerFullscreen(enabled bool) error {
	if tray.window == nil {
		return errors.New("Window unavailable")
	}
	mygo.RunOnMain(func() {
		if tray.playerFullscreen == enabled {
			return
		}
		if enabled {
			tray.previousFullscreen = tray.window.IsFullScreen()
		}
		tray.playerFullscreen = enabled
		tray.window.SetFullScreen(enabled || tray.previousFullscreen)
	})
	return nil
}

func (tray *TrayControl) Action(action string) error {
	switch action {
	case "open":
		if tray.window == nil {
			return errors.New("Window unavailable")
		}
		if tray.window.IsMinimized() {
			tray.window.Restore()
		}
		tray.window.Show()
		tray.window.Focus()
		return nil
	case "quit":
		tray.quitting.Store(true)
		mygo.App.Quit()
		return nil
	case "toggle", "next", "mute", "acknowledgement":
		state := tray.State()
		if (action == "toggle" && !state.HasTrack) || (action == "next" && !state.HasNext) {
			return errors.New("Playback control unavailable")
		}
		if tray.window == nil {
			return errors.New("Player unavailable")
		}
		if action == "acknowledgement" {
			if tray.window.IsMinimized() {
				tray.window.Restore()
			}
			tray.window.Show()
			tray.window.Focus()
		}
		return TrayAction.Emit(tray.window, action)
	default:
		return errors.New("Unknown action")
	}
}
