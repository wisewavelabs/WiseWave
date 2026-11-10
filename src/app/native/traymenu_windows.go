package native

import (
	"fmt"
	"syscall"
	"unsafe"

	"github.com/egoist/mygo"
	"golang.org/x/sys/windows"
)

var user32 = windows.NewLazySystemDLL("user32.dll")
var createPopupMenu = user32.NewProc("CreatePopupMenu")
var appendMenu = user32.NewProc("AppendMenuW")
var destroyMenu = user32.NewProc("DestroyMenu")
var getCursorPos = user32.NewProc("GetCursorPos")
var createWindow = user32.NewProc("CreateWindowExW")
var showWindow = user32.NewProc("ShowWindow")
var foregroundWindow = user32.NewProc("SetForegroundWindow")
var trackPopupMenu = user32.NewProc("TrackPopupMenu")
var postMessage = user32.NewProc("PostMessageW")
var destroyWindow = user32.NewProc("DestroyWindow")

func showTrayMenu(control *TrayControl) error {
	menu, _, err := createPopupMenu.Call()
	if menu == 0 {
		return fmt.Errorf("create menu: %w", err)
	}
	defer destroyMenu.Call(menu)
	state := control.State()
	play := "Play"
	if state.Playing {
		play = "Pause"
	}
	add := func(id uintptr, label string, enabled, checked bool) error {
		flags := uintptr(0)
		if !enabled {
			flags |= 1
		}
		if checked {
			flags |= 8
		}
		text, err := syscall.UTF16PtrFromString(label)
		if err != nil {
			return err
		}
		ok, _, callErr := appendMenu.Call(menu, flags, id, uintptr(unsafe.Pointer(text)))
		if ok == 0 {
			return callErr
		}
		return nil
	}
	for _, entry := range []struct {
		id               uintptr
		label            string
		enabled, checked bool
	}{
		{1, play, state.HasTrack, false},
		{2, "Next track", state.HasNext, false},
		{3, "Mute", true, state.Muted},
		{4, "Start with Windows", !mygo.IsDev(), mygo.App.OpenAtLogin()},
	} {
		if err := add(entry.id, entry.label, entry.enabled, entry.checked); err != nil {
			return fmt.Errorf("add menu item: %w", err)
		}
	}
	if ok, _, callErr := appendMenu.Call(menu, 0x800, 0, 0); ok == 0 {
		return fmt.Errorf("add separator: %w", callErr)
	}
	if err := add(5, "Exit", true, false); err != nil {
		return err
	}
	var point struct{ x, y int32 }
	if ok, _, callErr := getCursorPos.Call(uintptr(unsafe.Pointer(&point))); ok == 0 {
		return fmt.Errorf("get cursor position: %w", callErr)
	}
	class, _ := syscall.UTF16PtrFromString("STATIC")
	owner, _, callErr := createWindow.Call(0x80, uintptr(unsafe.Pointer(class)), 0, 0x80000000, 0, 0, 0, 0, 0, 0, 0, 0)
	if owner == 0 {
		return fmt.Errorf("create menu window: %w", callErr)
	}
	defer destroyWindow.Call(owner)
	showWindow.Call(owner, 5)
	foregroundWindow.Call(owner)
	chosen, _, _ := trackPopupMenu.Call(menu, 0x1a2, uintptr(point.x), uintptr(point.y), 0, owner, 0)
	postMessage.Call(owner, 0, 0, 0)
	switch chosen {
	case 1:
		return control.Action("toggle")
	case 2:
		return control.Action("next")
	case 3:
		return control.Action("mute")
	case 4:
		return mygo.App.SetOpenAtLogin(!mygo.App.OpenAtLogin())
	case 5:
		return control.Action("quit")
	}
	return nil
}
