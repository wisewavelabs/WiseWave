//go:build windows

package native

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	ole32DLL                   = windows.NewLazySystemDLL("ole32.dll")
	procCoInitializeEx         = ole32DLL.NewProc("CoInitializeEx")
	procCoUninitialize         = ole32DLL.NewProc("CoUninitialize")
	procCoCreateInstance       = ole32DLL.NewProc("CoCreateInstance")
	shell32DLL                 = windows.NewLazySystemDLL("shell32.dll")
	procSetCurrentProcessAUMID = shell32DLL.NewProc("SetCurrentProcessExplicitAppUserModelID")
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type propertyKey struct {
	Format guid
	ID     uint32
}

type propVariant struct {
	VT  uint16
	_   uint16
	_   uint32
	Val uintptr
	_   [2]int32
}

var (
	clsidShellLink    = guid{0x00021401, 0x0000, 0x0000, [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}
	iidIShellLinkW    = guid{0x000214F9, 0x0000, 0x0000, [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}
	iidIPersistFile   = guid{0x0000010B, 0x0000, 0x0000, [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}
	iidIPropertyStore = guid{0x886D8EEB, 0x8CF2, 0x4446, [8]byte{0x8D, 0x02, 0xCD, 0xBA, 0x1D, 0xBD, 0xCF, 0x99}}
	pkeyAppUserModelID = propertyKey{
		Format: guid{0x9F4C2855, 0x9F79, 0x4B39, [8]byte{0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3}},
		ID:     5,
	}
)

const (
	clsctxInprocServer = 0x1
	coinitApartment    = 0x2
	vtLPWSTR           = 31

	slSetWorkingDirectory = 9
	slSetIconLocation     = 17
	slSetPath             = 20

	pfSave     = 6
	psSetValue = 6
	psCommit   = 7
)

func initAppIdentity() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	exe, err = filepath.Abs(exe)
	if err != nil {
		return
	}

	name := "WiseWave"
	aumid := "com.wisewave.app"
	if isDevExecutable(exe) {
		name = "WiseWave Dev"
		aumid = "com.wisewave.app.dev"
		restoreReleaseShortcut()
	}

	setProcessAUMID(aumid)
	_ = writeStartMenuShortcut(name, exe, aumid)
}

func isDevExecutable(exe string) bool {
	base := strings.ToLower(filepath.Base(exe))
	if strings.Contains(base, "dev") {
		return true
	}
	normalized := strings.ToLower(filepath.ToSlash(exe))
	return strings.Contains(normalized, "/.mygo/dev/")
}

func restoreReleaseShortcut() {
	release := filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "WiseWave", "WiseWave.exe")
	if _, err := os.Stat(release); err != nil {
		return
	}
	_ = writeStartMenuShortcut("WiseWave", release, "com.wisewave.app")
}

func setProcessAUMID(id string) {
	ptr, err := windows.UTF16PtrFromString(id)
	if err != nil {
		return
	}
	procSetCurrentProcessAUMID.Call(uintptr(unsafe.Pointer(ptr)))
}

func writeStartMenuShortcut(name, exe, aumid string) error {
	dir := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	lnk := filepath.Join(dir, name+".lnk")

	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	hr, _, _ := procCoInitializeEx.Call(0, coinitApartment)
	if hr != 0 && hr != 0x00000001 && hr != 0x80010106 {
		return syscall.Errno(hr)
	}
	if hr == 0 {
		defer procCoUninitialize.Call()
	}

	var shellLink uintptr
	hr, _, _ = procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(&clsidShellLink)),
		0,
		clsctxInprocServer,
		uintptr(unsafe.Pointer(&iidIShellLinkW)),
		uintptr(unsafe.Pointer(&shellLink)),
	)
	if hr != 0 || shellLink == 0 {
		return syscall.Errno(hr)
	}
	defer releaseCOM(shellLink)

	if err := comCall(shellLink, slSetPath, uintptr(unsafe.Pointer(utf16Ptr(exe)))); err != nil {
		return err
	}
	if err := comCall(shellLink, slSetWorkingDirectory, uintptr(unsafe.Pointer(utf16Ptr(filepath.Dir(exe))))); err != nil {
		return err
	}
	_ = comCall(shellLink, slSetIconLocation, uintptr(unsafe.Pointer(utf16Ptr(exe))), 0)

	if store := queryInterface(shellLink, &iidIPropertyStore); store != 0 {
		s := utf16Slice(aumid)
		v := propVariant{VT: vtLPWSTR, Val: uintptr(unsafe.Pointer(&s[0]))}
		_ = comCall(store, psSetValue, uintptr(unsafe.Pointer(&pkeyAppUserModelID)), uintptr(unsafe.Pointer(&v)))
		runtime.KeepAlive(s)
		_ = comCall(store, psCommit)
		releaseCOM(store)
	}

	persist := queryInterface(shellLink, &iidIPersistFile)
	if persist == 0 {
		return syscall.EINVAL
	}
	defer releaseCOM(persist)
	return comCall(persist, pfSave, uintptr(unsafe.Pointer(utf16Ptr(lnk))), 1)
}

func utf16Ptr(s string) *uint16 {
	p, _ := windows.UTF16PtrFromString(s)
	return p
}

func utf16Slice(s string) []uint16 {
	return append(utf16.Encode([]rune(s)), 0)
}

func comCall(obj uintptr, method uintptr, args ...uintptr) error {
	if obj == 0 {
		return syscall.EINVAL
	}
	vtable := *(*uintptr)(unsafe.Pointer(obj))
	fn := *(*uintptr)(unsafe.Pointer(vtable + method*unsafe.Sizeof(uintptr(0))))
	params := make([]uintptr, 0, 1+len(args))
	params = append(params, obj)
	params = append(params, args...)
	hr, _, _ := syscall.SyscallN(fn, params...)
	if hr != 0 {
		return syscall.Errno(hr)
	}
	return nil
}

func queryInterface(obj uintptr, iid *guid) uintptr {
	var out uintptr
	if comCall(obj, 0, uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&out))) != nil {
		return 0
	}
	return out
}

func releaseCOM(obj uintptr) {
	_ = comCall(obj, 2)
}
