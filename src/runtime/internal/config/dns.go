package config

import (
	"context"
	"net"
	"os"
)

func ConfigureDNS() {
	socket := os.Getenv("WISEWAVE_DNS_SOCKET")
	if socket == "" {
		return
	}
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		conn, err := (&net.Dialer{}).DialContext(ctx, "unix", socket)
		if err != nil {
			return nil, err
		}
		return struct{ net.Conn }{conn}, nil
	}}
}
