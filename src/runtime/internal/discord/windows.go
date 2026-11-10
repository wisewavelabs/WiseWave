//go:build windows

package discord

import (
	"context"
	"fmt"
	"net"
	"time"

	"github.com/Microsoft/go-winio"
)

func dialDiscord(ctx context.Context) (net.Conn, error) {
	var lastErr error
	for index := range 10 {
		for _, format := range []string{"\\\\?\\pipe\\discord-ipc-%d", "\\\\.\\pipe\\discord-ipc-%d"} {
			pipe := fmt.Sprintf(format, index)
			pipeCtx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
			conn, err := winio.DialPipeContext(pipeCtx, pipe)
			cancel()
			if err == nil {
				return conn, nil
			}
			lastErr = err
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
		}
	}
	return nil, lastErr
}
