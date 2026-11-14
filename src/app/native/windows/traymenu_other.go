//go:build !windows

package windows

import "errors"

func showTrayMenu(_ *TrayControl) error {
	return errors.New("tray menu is only supported on Windows")
}
