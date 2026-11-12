package native

import (
	"context"
	"errors"
	"log"

	"github.com/egoist/mygo"
	"wisewave-runtime/desktop"
)

func Run(icon []byte) {
	initAppIdentity()
	mygo.App.SetName("WiseWave")
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	var engine *tokenEngine
	music := desktop.NewMusicWithTokens(func(ctx context.Context, videoID, visitor string) (string, string, error) {
		if engine == nil {
			return "", "", errors.New("token engine unavailable")
		}
		return engine.tokens(ctx, videoID, visitor)
	})
	trayControl := &TrayControl{}
	mygo.App.OnSecondInstance(func([]string, string) {
		if trayControl.window != nil {
			if err := trayControl.Action("open"); err != nil {
				log.Printf("show existing window: %v", err)
			}
		}
	})
	playback := desktop.NewPlayback(music)
	mini := &MiniWindow{}
	trayControl.minimizeToTray.Store(true)
	discord := desktop.NewDiscord()
	mediaSession := desktop.NewMediaSession(playback)
	mygo.Bind(music, playback, trayControl, mini, discord, mediaSession, &Clipboard{}, &HistoryExport{})
	if err := mygo.Protocol.Handle("audio", desktop.Audio{Music: music}); err != nil {
		log.Fatal(err)
	}
	mygo.App.WhenReady(func() {
		engine = newTokenEngine()
		page := mygo.PageOptions{}
		if !mygo.IsDev() {
			page.DevTools = mygo.DevToolsDisabled
			page.PreloadScript = `window.addEventListener("contextmenu", event => event.preventDefault(), true);`
		}
		startMinimized := mygo.App.WasOpenedAtLogin() && startupMinimized()
		window := mygo.NewWindow(mygo.WindowOptions{
			Title:           "WiseWave",
			Width:           1180,
			Height:          760,
			MinWidth:        900,
			MinHeight:       600,
			Maximized:       true,
			Hidden:          startMinimized,
			URL:             "/",
			BackgroundColor: "#111113",
			TitleBarStyle:   mygo.TitleBarHidden,
			TitleBarHeight:  80,
			Page:            page,
		})
		window.Page().OnContextMenu(func(e *mygo.ContextMenuEvent) {
			e.PreventDefault()
		})
		window.SetWindowButtonsTheme(mygo.ThemeDark)
		centerRestored := func() {
			bounds := window.Bounds()
			display := mygo.Screen.DisplayMatching(bounds)
			area := display.WorkArea
			if area.Width <= 0 || area.Height <= 0 {
				area = display.Bounds
			}
			if area.Width <= 0 || area.Height <= 0 {
				window.SetSize(1180, 760)
				window.Center()
				return
			}

			targetW := int(float64(area.Width) * 0.8)
			targetH := int(float64(area.Height) * 0.8)
			if targetW < 960 {
				targetW = area.Width - 80
			}
			if targetH < 620 {
				targetH = area.Height - 80
			}
			if targetW > area.Width-60 {
				targetW = area.Width - 60
			}
			if targetH > area.Height-60 {
				targetH = area.Height - 60
			}

			x := area.X + (area.Width-targetW)/2
			y := area.Y + (area.Height-targetH)/2
			window.SetBounds(mygo.Rectangle{
				X:      x,
				Y:      y,
				Width:  targetW,
				Height: targetH,
			})
		}
		window.OnUnmaximize(func() {
			centerRestored()
		})
		trayControl.window = window
		show := func() {
			if err := trayControl.Action("open"); err != nil {
				log.Printf("show window: %v", err)
			}
		}
		tray, err := mygo.NewTray(mygo.TrayOptions{
			ID: "wisewave", Icon: icon, ToolTip: "WiseWave",
		})
		if err != nil {
			log.Printf("system tray unavailable: %v", err)
			window.Show()
			return
		}
		trayControl.tray = tray
		if startMinimized {
			window.Minimize()
		}
		tray.OnClick(show)
		tray.OnRightClick(func() {
			if err := showTrayMenu(trayControl); err != nil {
				log.Printf("tray menu: %v", err)
			}
		})
		window.OnMinimize(func() {
			if trayControl.miniWhenMinimized.Load() && !mini.isOpen() {
				trayControl.autoMini.Store(true)
				mini.Open()
			}
		})
		window.OnRestore(func() {
			if trayControl.autoMini.Swap(false) {
				mini.Close()
			}
		})
		window.OnClose(func(event *mygo.CloseEvent) {
			if !trayControl.quitting.Load() && trayControl.minimizeToTray.Load() {
				event.PreventDefault()
				window.Hide()
			} else if !trayControl.quitting.Load() {
				trayControl.quitting.Store(true)
				mygo.App.Quit()
			}
		})
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
