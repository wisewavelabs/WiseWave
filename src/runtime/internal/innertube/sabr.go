package innertube

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const (
	UMPPartOnesieHeader         = 10
	UMPPartOnesieData           = 11
	UMPPartMediaHeader          = 20
	UMPPartMedia                = 21
	UMPPartMediaEnd             = 22
	UMPPartFormatInitMetadata   = 31
	UMPPartContextSendingPolicy = 32
	UMPPartContextUpdate        = 33
	UMPPartSabrError            = 34
	UMPPartSabrRedirect         = 35
	UMPPartNextRequestPolicy    = 36
	UMPPartStreamProtection     = 37
)

type UMPReader struct {
	source         io.ReadCloser
	br             *bufio.Reader
	pending        []byte
	targetHeaderID byte
	hasTarget      bool
	err            error
}

func NewUMPReader(source io.ReadCloser) *UMPReader {
	return &UMPReader{
		source: source,
		br:     bufio.NewReaderSize(source, 64*1024),
	}
}

func (r *UMPReader) Close() error {
	return r.source.Close()
}

func (r *UMPReader) Read(p []byte) (int, error) {
	if len(r.pending) > 0 {
		n := copy(p, r.pending)
		r.pending = r.pending[n:]
		return n, nil
	}

	if r.err != nil {
		return 0, r.err
	}

	for {
		partType, err := readVarInt(r.br)
		if err != nil {
			r.err = err
			return 0, err
		}

		partLength, err := readVarInt(r.br)
		if err != nil {
			r.err = err
			return 0, err
		}

		if partLength > 32<<20 {
			r.err = fmt.Errorf("sabr: oversized UMP part (%d bytes)", partLength)
			return 0, r.err
		}

		payload := make([]byte, partLength)
		if _, err := io.ReadFull(r.br, payload); err != nil {
			r.err = err
			return 0, err
		}

		switch partType {
		case UMPPartMedia:
			if len(payload) <= 1 {
				continue
			}
			headerID := payload[0]
			if !r.hasTarget {
				r.targetHeaderID = headerID
				r.hasTarget = true
			}
			if r.targetHeaderID == headerID {
				mediaBytes := payload[1:]
				n := copy(p, mediaBytes)
				if n < len(mediaBytes) {
					r.pending = mediaBytes[n:]
				}
				return n, nil
			}

		case UMPPartSabrError:
			r.err = fmt.Errorf("sabr server error: %s", string(payload))
			return 0, r.err

		case UMPPartMediaEnd:

		default:

		}
	}
}

func readVarInt(r *bufio.Reader) (uint64, error) {
	var val uint64
	var shift uint
	for {
		b, err := r.ReadByte()
		if err != nil {
			return 0, err
		}
		val |= uint64(b&0x7F) << shift
		if (b & 0x80) == 0 {
			break
		}
		shift += 7
		if shift >= 64 {
			return 0, errors.New("varint overflow")
		}
	}
	return val, nil
}

func WrapIfSABR(resp *http.Response) io.ReadCloser {
	if resp == nil || resp.Body == nil {
		return nil
	}
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.Contains(contentType, "application/vnd.yt-ump") || strings.Contains(contentType, "application/yt-ump") {
		return NewUMPReader(resp.Body)
	}
	return resp.Body
}
