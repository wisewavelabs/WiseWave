package native

import (
	"github.com/egoist/mygo"
	"sync"
)

type MiniWindow struct {
	mu     sync.Mutex
	window *mygo.Window
}

func (m *MiniWindow) isOpen() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.window != nil && !m.window.IsDestroyed() && m.window.IsVisible()
}

func (m *MiniWindow) Open() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.window != nil && !m.window.IsDestroyed() {
		m.window.Show()
		m.window.Focus()
		return
	}
	m.window = mygo.NewWindow(mygo.WindowOptions{Title: "WiseWave Mini Player", Width: 300, Height: 328, MinWidth: 240, MinHeight: 268, UseContentSize: true, URL: "/?view=mini", Frameless: true, AlwaysOnTop: true, SkipTaskbar: true, BackgroundColor: "#000000"})
	m.window.Page().OnContextMenu(func(e *mygo.ContextMenuEvent) {
		e.PreventDefault()
	})
}
func (m *MiniWindow) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.window != nil && !m.window.IsDestroyed() {
		m.window.Close()
	}
}
