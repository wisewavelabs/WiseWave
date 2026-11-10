package native

import (
	"encoding/json"
	"errors"
	"os"

	"github.com/egoist/mygo"
)

type HistoryExport struct{}

func (HistoryExport) Save(data string) (bool, error) {
	if len(data) > 4*1024*1024 || !json.Valid([]byte(data)) {
		return false, errors.New("Invalid history data")
	}
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{
		Title:       "Export listening history",
		DefaultPath: "wisewave-listening-history.json",
		Filters:     []mygo.FileFilter{{Name: "JSON files", Extensions: []string{"json"}}},
	})
	if err != nil || path == "" {
		return false, err
	}
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		return false, err
	}
	return true, nil
}
