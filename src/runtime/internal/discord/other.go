//go:build !darwin && !linux && !windows

package discord

import (
	"context"
	"errors"
	"net"
)

func dialDiscord(context.Context) (net.Conn, error) {
	return nil, errors.New("discord Rich Presence is not supported on this platform")
}
