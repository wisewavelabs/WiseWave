package desktop

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"github.com/tphakala/go-aac/pcm"
	audiostream "github.com/tphakala/go-audio-stream"
	"github.com/tphakala/go-audio-stream/hlssource"
	"github.com/tphakala/go-m4a"
)

const maxAACSourceBytes = 128 << 20

type aacDecoder struct {
	decoder  *pcm.Decoder
	rate     int
	channels int
	length   int64
	frame    int64
	pcmBuf   []byte
	mp4      *m4a.Reader
	pipe     *aacFramePipe
	hls      *hlssource.Client
	hlsURL   string
	waiting  atomic.Bool
}

func newM4AAACDecoder(data []byte) (*aacDecoder, error) {
	reader := bytes.NewReader(data)
	container, err := m4a.NewReader(reader)
	if err != nil {
		return nil, err
	}
	info := container.Info()
	if info.Codec != m4a.CodecAACLC || len(info.ASC) == 0 {
		return nil, errors.New("unsupported MP4 audio codec")
	}
	decoder, err := pcm.NewDecoder(container.RawStream(), pcm.WithRawStream(info.ASC))
	if err != nil {
		return nil, err
	}
	d := &aacDecoder{decoder: decoder, rate: info.SampleRate, channels: info.Channels, length: int64(info.Duration.Seconds() * float64(info.SampleRate)), mp4: container}
	if err := d.discardFrames(info.EncoderDelay); err != nil {
		return nil, err
	}
	d.frame = 0
	return d, nil
}

func newHLSAACDecoder(ctx context.Context, sourceURL string) (*aacDecoder, error) {
	d := &aacDecoder{hlsURL: sourceURL, length: -1}
	if err := d.openHLS(ctx); err != nil {
		return nil, err
	}
	return d, nil
}

func (d *aacDecoder) openHLS(ctx context.Context) error {
	pipe := newAACFramePipe()
	client, err := hlssource.Open(ctx, hlssource.Config{
		URL: d.hlsURL, UserAgent: audioUserAgent, MaxSegmentBytes: 16 << 20, ReadIdle: 60 * time.Second,
		OnFrame:       func(frame audiostream.Frame) { pipe.push(frame.Data) },
		OnCodecUpdate: func(audiostream.CodecUpdate) { pipe.fail(errors.New("HLS audio format changed during playback")) },
	})
	if err != nil {
		return err
	}
	go func() {
		if err := client.Wait(context.Background()); err != nil {
			pipe.fail(err)
		} else {
			pipe.fail(io.EOF)
		}
	}()
	codec, ok := client.Format().Codec.(audiostream.CodecAAC)
	if !ok || len(codec.AudioSpecificConfig) == 0 {
		_ = client.Close()
		return errors.New("HLS stream is not AAC audio")
	}
	decoder, err := pcm.NewDecoder(pipe, pcm.WithRawStream(codec.AudioSpecificConfig))
	if err != nil {
		_ = client.Close()
		return err
	}
	info := decoder.Info()
	d.decoder, d.rate, d.channels, d.pipe, d.hls = decoder, info.SampleRate, info.Channels, pipe, client
	return nil
}

func (d *aacDecoder) SampleRate() int { return d.rate }
func (d *aacDecoder) Channels() int   { return d.channels }
func (d *aacDecoder) Len() int64      { return d.length }

func (d *aacDecoder) Read(samples []float32) (int, error) {
	if d.decoder == nil || d.channels == 0 {
		return 0, errors.New("AAC decoder is not initialized")
	}
	if d.length >= 0 {
		remaining := d.length - d.frame
		if remaining <= 0 {
			return 0, io.EOF
		}
		if maxSamples := int(remaining) * d.channels; len(samples) > maxSamples {
			samples = samples[:maxSamples]
		}
	}
	bytesNeeded := len(samples) * 2
	if cap(d.pcmBuf) < bytesNeeded {
		d.pcmBuf = make([]byte, bytesNeeded)
	} else {
		d.pcmBuf = d.pcmBuf[:bytesNeeded]
	}
	d.waiting.Store(d.hls != nil)
	n, err := d.decoder.Read(d.pcmBuf)
	d.waiting.Store(false)
	n -= n % (d.channels * 2)
	for i := 0; i < n/2; i++ {
		samples[i] = float32(int16(binary.LittleEndian.Uint16(d.pcmBuf[i*2:]))) / 32768
	}
	d.frame += int64(n / (d.channels * 2))
	return n / 2, err
}

func (d *aacDecoder) SetPosition(frame int64) error {
	frame = max(0, frame)
	if d.mp4 != nil {
		sample, skip, err := d.mp4.SeekTime(time.Duration(frame) * time.Second / time.Duration(d.rate))
		if err != nil {
			return err
		}
		if err := d.mp4.SeekSample(sample); err != nil {
			return err
		}
		if err := d.decoder.Reset(d.mp4.RawStream(), pcm.WithRawStream(d.mp4.Info().ASC)); err != nil {
			return err
		}
		d.frame = frame - skip
		return d.discardFrames(skip)
	}
	if d.hls == nil {
		return errors.New("AAC stream cannot seek")
	}
	_ = d.hls.Close()
	if d.pipe != nil {
		d.pipe.fail(io.ErrClosedPipe)
	}
	if err := d.openHLS(context.Background()); err != nil {
		return err
	}
	d.frame = 0
	return d.discardFrames(frame)
}

func (d *aacDecoder) discardFrames(frames int64) error {
	buffer := make([]float32, 4096-(4096%d.channels))
	for frames > 0 {
		want := min(frames, int64(len(buffer)/d.channels))
		n, err := d.Read(buffer[:want*int64(d.channels)])
		frames -= int64(n / d.channels)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrNoProgress
		}
	}
	return nil
}

func (d *aacDecoder) Close() error {
	if d.hls != nil {
		err := d.hls.Close()
		if d.pipe != nil {
			_ = d.pipe.Close()
		}
		return err
	}
	return nil
}

func (d *aacDecoder) BufferAhead(bitrate int) float64 {
	if d.pipe == nil || bitrate <= 0 {
		return 0
	}
	return float64(d.pipe.queued()*8) / float64(bitrate)
}

type aacFramePipe struct {
	mu      sync.Mutex
	cond    *sync.Cond
	frames  [][]byte
	current []byte
	bytes   int
	err     error
	closed  bool
}

func newAACFramePipe() *aacFramePipe {
	p := &aacFramePipe{}
	p.cond = sync.NewCond(&p.mu)
	return p
}

func (p *aacFramePipe) push(frame []byte) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed || p.err != nil || len(frame) == 0 {
		return
	}
	if len(frame) > 65535 || p.bytes+len(frame)+2 > 16<<20 {
		p.err = errors.New("HLS audio buffer limit exceeded")
		p.cond.Broadcast()
		return
	}
	copyFrame := make([]byte, len(frame)+2)
	binary.BigEndian.PutUint16(copyFrame, uint16(len(frame)))
	copy(copyFrame[2:], frame)
	p.frames = append(p.frames, copyFrame)
	p.bytes += len(copyFrame)
	p.cond.Signal()
}

func (p *aacFramePipe) fail(err error) {
	p.mu.Lock()
	if !p.closed && p.err == nil {
		p.err = err
	}
	p.cond.Broadcast()
	p.mu.Unlock()
}

func (p *aacFramePipe) Read(dst []byte) (int, error) {
	if len(dst) == 0 {
		return 0, nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for p.current == nil && len(p.frames) == 0 && p.err == nil && !p.closed {
		p.cond.Wait()
	}
	if p.current == nil && len(p.frames) > 0 {
		p.current = p.frames[0]
		p.frames[0] = nil
		p.frames = p.frames[1:]
	}
	if p.current == nil {
		if p.err != nil {
			return 0, p.err
		}
		return 0, io.EOF
	}
	n := copy(dst, p.current)
	p.current = p.current[n:]
	p.bytes -= n
	if len(p.current) == 0 {
		p.current = nil
	}
	return n, nil
}

func (p *aacFramePipe) Close() error {
	p.mu.Lock()
	p.closed = true
	p.frames = nil
	p.current = nil
	p.bytes = 0
	p.cond.Broadcast()
	p.mu.Unlock()
	return nil
}

func (p *aacFramePipe) queued() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.bytes
}
