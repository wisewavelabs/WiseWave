package native

import (
	"errors"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

type Clipboard struct{}

func (Clipboard) WriteText(text string) error {
	if len(text) == 0 || len(text) > 4096 {
		return errors.New("Invalid clipboard text")
	}
	return mygo.Clipboard.Write(transfer.New(transfer.NewItem(transfer.Bytes(transfer.Text, []byte(text)))))
}
