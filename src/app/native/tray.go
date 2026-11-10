package native

import (
	"errors"
	"sync"
	"sync/atomic"

	"github.com/egoist/mygo"
)

var TrayAction = mygo.NewEvent[string]("tray-action")

type TrayState struct {
	HasTrack bool `json:"hasTrack"`
	Playing  bool `json:"playing"`
	HasNext  bool `json:"hasNext"`
	Muted    bool `json:"muted"`
}

type TrayControl struct {
	mu                sync.RWMutex
	state             TrayState
	window            *mygo.Window
	tray              *mygo.Tray
	quitting          atomic.Bool
	minimizeToTray    atomic.Bool
	miniWhenMinimized atomic.Bool
	autoMini          atomic.Bool
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
	case "toggle", "next", "mute":
		state := tray.State()
		if (action == "toggle" && !state.HasTrack) || (action == "next" && !state.HasNext) {
			return errors.New("Playback control unavailable")
		}
		if tray.window == nil {
			return errors.New("Player unavailable")
		}
		return TrayAction.Emit(tray.window, action)
	default:
		return errors.New("Unknown action")
	}
}
