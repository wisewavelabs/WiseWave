package storage

import (
	"github.com/egoist/mygo"
	"os"
	"path/filepath"
	"strings"
)

func Path(filename string) (string, error) {
	if dir, err := mygo.App.Path(mygo.PathUserData); err == nil && strings.TrimSpace(dir) != "" {
		return filepath.Join(dir, filename), nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "WiseWave", filename), nil
}
