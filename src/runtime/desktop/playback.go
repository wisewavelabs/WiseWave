package desktop

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo/audio"
	"github.com/fgn/puropus"
	"wisewave-runtime/internal/innertube"
)

type Playback struct {
	music           *Music
	audioCache      *audioCache
	prefetchID      string
	prefetchVersion uint64
	prefetchCancel  context.CancelFunc
	mu              sync.Mutex
	player          *audio.Player
	decoder         *opusDecoder
	streamBuf       *streamBuffer
	version         uint64
	cancel          context.CancelFunc
	err             string
	volume          float64
	currentID       string
	bitrate         int
	codec           string
	loudness        float64
	equalizer       atomic.Int32
	maxBitrate      atomic.Int32
	normalize       bool
	segments        []innertube.SponsorSegment
}

type PlaybackState struct {
	TrackID     string  `json:"track_id"`
	Duration    float64 `json:"duration"`
	Playing     bool    `json:"playing"`
	Position    float64 `json:"position"`
	Error       string  `json:"error"`
	Bitrate     int     `json:"bitrate"`
	Codec       string  `json:"codec"`
	SampleRate  int     `json:"sample_rate"`
	Channels    int     `json:"channels"`
	BufferAhead float64 `json:"buffer_ahead"`
	Buffering   bool    `json:"buffering"`
	LatencyMs   int     `json:"latency_ms"`
	LoudnessDb  float64 `json:"loudness_db"`
}

func NewPlayback(music *Music) *Playback {
	cache, err := newAudioCache()
	if err != nil {
		log.Printf("audio cache unavailable: %v", err)
	}
	p := &Playback{music: music, audioCache: cache, volume: 1.0, normalize: true}
	p.maxBitrate.Store(256000)
	return p
}

func (p *Playback) Play(id string) error { return p.load(id, 0, true) }
func (p *Playback) Prepare(id string, position float64) error {
	if math.IsNaN(position) || math.IsInf(position, 0) {
		return errors.New("Invalid playback position")
	}
	return p.load(id, max(0, min(position, 86400)), false)
}
func (p *Playback) load(id string, position float64, start bool) error {
	if !videoID.MatchString(id) {
		return errors.New("Invalid track")
	}
	p.mu.Lock()
	p.currentID = id
	p.version++
	if p.cancel != nil {
		p.cancel()
		p.cancel = nil
	}
	version := p.version
	if p.player != nil {
		p.player.Close()
		p.player = nil
	}
	if p.streamBuf != nil {
		p.streamBuf.Close()
		p.streamBuf = nil
	}
	p.decoder = nil
	p.err = ""
	p.bitrate = 0
	p.codec = ""
	p.loudness = 0
	p.segments = nil
	p.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	keep := false
	defer func() {
		if !keep {
			cancel()
		}
	}()
	p.mu.Lock()
	if version != p.version {
		p.mu.Unlock()
		cancel()
		return nil
	}
	p.cancel = cancel
	p.mu.Unlock()

	go func() {
		segCtx, segCancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer segCancel()
		if segs, err := innertube.DefaultSponsorBlock.GetSegments(segCtx, id); err == nil {
			p.mu.Lock()
			if p.version == version {
				p.segments = segs
			}
			p.mu.Unlock()
		}
	}()

	var sb *streamBuffer
	var decoder *opusDecoder
	var bitrate int
	var cached *cachedAudio
	if p.audioCache != nil {
		var err error
		cached, err = p.audioCache.get(id)
		if err != nil {
			log.Printf("read audio cache for %s: %v", id, err)
			if removeErr := p.audioCache.remove(id); removeErr != nil {
				log.Printf("remove invalid audio cache for %s: %v", id, removeErr)
			}
		}
	}
	if cached != nil {
		if limit := int(p.maxBitrate.Load()); limit > 0 && cached.bitrate > limit {
			cached = nil
		}
	}
	if cached != nil {
		if _, err := puropus.NewDecoder(bytes.NewReader(cached.data), puropus.DecodeOptions{}); err != nil {
			log.Printf("invalid cached audio for %s: %v", id, err)
			if removeErr := p.audioCache.remove(id); removeErr != nil {
				log.Printf("remove invalid audio cache for %s: %v", id, removeErr)
			}
			cached = nil
		}
	}
	if cached != nil {
		sb = newStreamBuffer(io.NopCloser(bytes.NewReader(cached.data)), cancel, int64(len(cached.data)), cached.bitrate, cached.duration, nil)
		var err error
		decoder, err = newOpus(sb)
		if err != nil {
			sb.Close()
			if removeErr := p.audioCache.remove(id); removeErr != nil {
				log.Printf("remove invalid audio cache for %s: %v", id, removeErr)
			}
			return errors.New("Cached audio could not be decoded; try again")
		}
		bitrate = cached.bitrate
	} else {
		stream, err := p.resolveStream(ctx, id)
		if err != nil {
			return errors.New("Audio is unavailable for this track")
		}

		fetchStream := func(streamURL string) (*http.Response, error) {
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, streamURL, nil)
			if err != nil {
				return nil, err
			}
			req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
			return p.music.http.Do(req)
		}

		response, err := fetchStream(stream.URL)
		if err != nil || (response != nil && response.StatusCode != http.StatusOK) {
			if response != nil {
				_ = response.Body.Close()
			}
			p.music.streams.Invalidate(id)
			resolved, resErr := p.music.client.ResolveAudio(ctx, id, innertube.StreamOptions{
				PreferredCodec: innertube.CodecOpus,
				RequireCodec:   true,
				Validate:       true,
				MaxBitrate:     int(p.maxBitrate.Load()),
			})
			if resErr != nil {
				return errors.New("Audio could not be loaded")
			}
			if limit := int(p.maxBitrate.Load()); limit > 0 && resolved.Bitrate > limit {
				return errors.New("Audio quality could not be applied")
			}
			stream = resolved
			p.music.streams.Put(id, *resolved)
			response, err = fetchStream(stream.URL)
			if err != nil || (response != nil && response.StatusCode != http.StatusOK) {
				if response != nil {
					_ = response.Body.Close()
				}
				cancel()
				return errors.New("Audio could not be loaded")
			}
		}

		bitrate = stream.Bitrate
		duration := time.Duration(stream.DurationMs) * time.Millisecond
		sb = newStreamBuffer(innertube.WrapIfSABR(response), cancel, response.ContentLength, bitrate, duration, func(data []byte) { p.storeAudio(id, data, bitrate, duration) })
		decoder, err = newOpus(sb)
		if err != nil {
			sb.Close()
			cancel()
			return errors.New("Audio could not be decoded")
		}

	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if version != p.version {
		decoder.Close()
		sb.Close()
		return nil
	}

	decoder.equalizer = &p.equalizer
	player := audio.NewPlayer(decoder)
	targetGain := innertube.CalculateLoudnessGain(p.loudness, p.normalize)
	player.SetVolume(p.volume * targetGain)
	p.player = player
	p.decoder = decoder
	p.streamBuf = sb
	p.bitrate = bitrate
	p.codec = "Opus"
	if position > 0 {
		player.Seek(time.Duration(position * float64(time.Second)))
	}
	if start {
		player.Play()
	}

	if err := audio.Err(); start && err != nil {
		player.Close()
		p.player = nil
		p.decoder = nil
		p.streamBuf = nil
		sb.Close()
		return errors.New("Audio output is unavailable")
	}
	keep = true

	go func() {
		lCtx, lCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer lCancel()
		if l, err := p.music.client.Loudness(lCtx, id); err == nil && l.LoudnessDB != 0 {
			p.mu.Lock()
			if p.version == version && p.player != nil {
				p.loudness = l.LoudnessDB
				gain := innertube.CalculateLoudnessGain(p.loudness, p.normalize)
				p.player.SetVolume(p.volume * gain)
			}
			p.mu.Unlock()
		}
	}()

	return nil
}

func (p *Playback) Pause() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.player != nil {
		p.player.Pause()
	}
}

func (p *Playback) Resume() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.player != nil {
		p.player.Play()
	}
}

func (p *Playback) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.player != nil {
		p.player.Stop()
	}
}

func (p *Playback) Reset() error {
	p.mu.Lock()
	id := p.currentID
	pos := 0.0
	if p.player != nil {
		pos = p.player.Position().Seconds()
	}
	p.mu.Unlock()
	if id == "" {
		return nil
	}
	if err := p.Play(id); err != nil {
		return err
	}
	if pos > 0 {
		p.Seek(pos)
	}
	return nil
}

func (p *Playback) Seek(seconds float64) {
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.player != nil {
		p.player.Seek(time.Duration(max(0, min(seconds, 86400)) * float64(time.Second)))
	}
}

func (p *Playback) Volume(value float64) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.volume = max(0, min(value, 1))
	if p.player != nil {
		targetGain := innertube.CalculateLoudnessGain(p.loudness, p.normalize)
		p.player.SetVolume(p.volume * targetGain)
	}
}

func (p *Playback) SetStreamingQuality(quality string) error {
	limits := map[string]int32{"Normal": 96000, "High": 256000}
	limit, ok := limits[quality]
	if !ok {
		return errors.New("Unsupported streaming quality")
	}
	p.mu.Lock()
	changed, currentID := p.maxBitrate.Swap(limit) != limit, p.currentID
	p.mu.Unlock()
	if changed && currentID != "" {
		p.music.streams.Invalidate(currentID)
	}
	return nil
}

func (p *Playback) SetEqualizer(preset string) error {
	presets := map[string]int32{"Flat": 0, "Bass boost": 1, "Vocal": 2, "Treble boost": 3, "Acoustic": 4}
	value, ok := presets[preset]
	if !ok {
		return errors.New("Invalid equalizer preset")
	}
	p.equalizer.Store(value)
	return nil
}

func (p *Playback) SetNormalize(enable bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.normalize = enable
	if p.player != nil {
		targetGain := innertube.CalculateLoudnessGain(p.loudness, p.normalize)
		p.player.SetVolume(p.volume * targetGain)
	}
}

func (p *Playback) storeAudio(id string, data []byte, bitrate int, duration time.Duration) {
	if p.audioCache == nil {
		return
	}
	source, err := puropus.ReadPackets(bytes.NewReader(data))
	if err != nil {
		log.Printf("audio cache validation for %s: %v", id, err)
		return
	}
	if duration <= 0 {
		duration = source.Duration()
	}
	if bitrate <= 0 && duration > 0 {
		bitrate = int(float64(len(data)*8) / duration.Seconds())
	}
	if err := p.audioCache.put(id, data, bitrate, duration); err != nil {
		log.Printf("write audio cache for %s: %v", id, err)
	}
}

func (p *Playback) resolveStream(ctx context.Context, id string) (*innertube.ResolvedAudioStream, error) {
	if stream, ok := p.music.streams.Get(id); ok && (p.maxBitrate.Load() == 0 || stream.Bitrate <= int(p.maxBitrate.Load())) {
		return stream, nil
	}
	p.music.streams.Invalidate(id)
	stream, err := p.music.client.ResolveAudio(ctx, id, innertube.StreamOptions{PreferredCodec: innertube.CodecOpus, RequireCodec: true, Validate: true, MaxBitrate: int(p.maxBitrate.Load())})
	if err == nil {
		p.music.streams.Put(id, *stream)
	}
	return stream, err
}

func (p *Playback) Prefetch(id string) {
	p.mu.Lock()
	if p.prefetchID == id {
		p.mu.Unlock()
		return
	}
	if p.prefetchCancel != nil {
		p.prefetchCancel()
		p.prefetchCancel = nil
	}
	p.prefetchID = id
	p.prefetchVersion++
	version := p.prefetchVersion
	if !videoID.MatchString(id) {
		p.mu.Unlock()
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	p.prefetchCancel = cancel
	p.mu.Unlock()
	go func() {
		defer cancel()
		defer func() {
			p.mu.Lock()
			if p.prefetchVersion == version {
				p.prefetchID = ""
				p.prefetchCancel = nil
			}
			p.mu.Unlock()
		}()
		if p.audioCache != nil {
			cached, err := p.audioCache.get(id)
			if err != nil {
				log.Printf("read prefetched audio cache for %s: %v", id, err)
				if removeErr := p.audioCache.remove(id); removeErr != nil {
					log.Printf("remove invalid audio cache for %s: %v", id, removeErr)
				}
			}
			if cached != nil {
				return
			}
		}
		stream, err := p.resolveStream(ctx, id)
		if err != nil {
			if ctx.Err() == nil {
				log.Printf("prefetch audio for %s: %v", id, err)
			}
			return
		}
		if p.audioCache == nil {
			return
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, stream.URL, nil)
		if err != nil {
			log.Printf("prefetch audio request for %s: %v", id, err)
			return
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
		response, err := p.music.http.Do(req)
		if err != nil {
			if ctx.Err() == nil {
				log.Printf("prefetch audio for %s: %v", id, err)
			}
			return
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			p.music.streams.Invalidate(id)
			log.Printf("prefetch audio for %s: HTTP %d", id, response.StatusCode)
			return
		}
		data, err := io.ReadAll(io.LimitReader(innertube.WrapIfSABR(response), 128<<20))
		if err != nil {
			if ctx.Err() == nil {
				log.Printf("prefetch audio for %s: %v", id, err)
			}
			return
		}
		if ctx.Err() != nil || len(data) == 128<<20 {
			return
		}
		p.storeAudio(id, data, stream.Bitrate, time.Duration(stream.DurationMs)*time.Millisecond)
	}()
}

func (p *Playback) State() PlaybackState {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.player == nil {
		return PlaybackState{TrackID: p.currentID, Error: p.err, LoudnessDb: p.loudness}
	}
	if audio.Err() != nil {
		return PlaybackState{TrackID: p.currentID, Position: p.player.Position().Seconds(), Error: "Audio output is unavailable", LoudnessDb: p.loudness}
	}
	sampleRate := 0
	channels := 0
	if p.decoder != nil {
		sampleRate = p.decoder.SampleRate()
		channels = p.decoder.Channels()
	}
	pos := p.player.Position().Seconds()
	if p.player.Playing() && len(p.segments) > 0 {
		for _, seg := range p.segments {
			if seg.ActionType == "skip" || seg.ActionType == "" {
				if pos >= seg.Start() && pos < seg.End()-0.5 {
					p.player.Seek(time.Duration(seg.End() * float64(time.Second)))
					pos = seg.End()
					break
				}
			}
		}
	}

	bufferAhead := 0.0
	duration := 0.0
	if p.streamBuf != nil {
		bufferAhead = p.streamBuf.BufferAhead(pos)
		duration = p.streamBuf.duration.Seconds()
	}
	latencyMs := 0
	if p.player.Playing() {
		latencyMs = 40
	}
	return PlaybackState{
		TrackID:     p.currentID,
		Duration:    duration,
		Playing:     p.player.Playing(),
		Position:    pos,
		Error:       p.err,
		Bitrate:     p.bitrate,
		Codec:       p.codec,
		SampleRate:  sampleRate,
		Channels:    channels,
		BufferAhead: bufferAhead,
		Buffering:   p.player.Playing() && p.streamBuf != nil && p.streamBuf.waiting.Load() > 0,
		LatencyMs:   latencyMs,
		LoudnessDb:  p.loudness,
	}
}

type streamBuffer struct {
	mu            sync.Mutex
	cond          *sync.Cond
	data          []byte
	err           error
	done          bool
	source        io.ReadCloser
	cancel        context.CancelFunc
	contentLength int64
	bitrate       int
	duration      time.Duration
	waiting       atomic.Int32
	onComplete    func([]byte)
}

func newStreamBuffer(source io.ReadCloser, cancel context.CancelFunc, contentLength int64, bitrate int, duration time.Duration, onComplete func([]byte)) *streamBuffer {
	sb := &streamBuffer{
		source:        source,
		cancel:        cancel,
		contentLength: contentLength,
		bitrate:       bitrate,
		duration:      duration,
		onComplete:    onComplete,
	}
	sb.cond = sync.NewCond(&sb.mu)
	go sb.fetch()
	return sb
}

func (sb *streamBuffer) fetch() {
	buf := make([]byte, 32*1024)
	for {
		n, err := sb.source.Read(buf)
		sb.mu.Lock()
		if n > 0 {
			sb.data = append(sb.data, buf[:n]...)
			sb.cond.Broadcast()
		}
		if err != nil {
			sb.err = err
			sb.done = true
			sb.cond.Broadcast()
			data, complete := sb.data, sb.onComplete
			sb.mu.Unlock()
			if errors.Is(err, io.EOF) && complete != nil {
				go complete(data)
			}
			return
		}
		sb.mu.Unlock()
	}
}

func (sb *streamBuffer) Close() error {
	sb.cancel()
	return sb.source.Close()
}

func (sb *streamBuffer) BufferAhead(pos float64) float64 {
	sb.mu.Lock()
	defer sb.mu.Unlock()
	downloaded := len(sb.data)
	if downloaded == 0 {
		return 0
	}
	var bufferedSec float64
	if sb.done && (sb.err == nil || errors.Is(sb.err, io.EOF)) && sb.duration > 0 {
		bufferedSec = sb.duration.Seconds()
	} else if sb.contentLength > 0 && sb.duration > 0 {
		bufferedSec = (float64(downloaded) / float64(sb.contentLength)) * sb.duration.Seconds()
	} else if sb.bitrate > 0 {
		bufferedSec = (float64(downloaded) * 8.0) / float64(sb.bitrate)
	}
	if sb.duration > 0 && bufferedSec > sb.duration.Seconds() {
		bufferedSec = sb.duration.Seconds()
	}
	ahead := bufferedSec - pos
	if ahead < 0 {
		return 0
	}
	return ahead
}

type streamBufferReader struct {
	sb     *streamBuffer
	offset int
}

func (r *streamBufferReader) Read(p []byte) (int, error) {
	r.sb.mu.Lock()
	defer r.sb.mu.Unlock()
	for r.offset >= len(r.sb.data) {
		if r.sb.done {
			if r.sb.err != nil && !errors.Is(r.sb.err, io.EOF) {
				return 0, r.sb.err
			}
			return 0, io.EOF
		}
		r.sb.waiting.Add(1)
		r.sb.cond.Wait()
		r.sb.waiting.Add(-1)
	}
	n := copy(p, r.sb.data[r.offset:])
	r.offset += n
	return n, nil
}

type opusDecoder struct {
	sb           *streamBuffer
	decoder      *puropus.Decoder
	rate         int
	channels     int
	source       *puropus.Source
	indexedBytes int
	frame        int64
	eof          bool
	equalizer    *atomic.Int32
	eqPreset     int32
	eqFilters    []eqFilter
}

func newOpus(sb *streamBuffer) (*opusDecoder, error) {
	decoder, err := puropus.NewDecoder(&streamBufferReader{sb: sb}, puropus.DecodeOptions{})
	if err != nil {
		return nil, err
	}
	return &opusDecoder{sb: sb, decoder: decoder, rate: decoder.SampleRate(), channels: decoder.Channels()}, nil
}

func (d *opusDecoder) SampleRate() int { return d.rate }
func (d *opusDecoder) Channels() int   { return d.channels }
func (d *opusDecoder) Len() int64      { return -1 }
func (d *opusDecoder) Read(samples []float32) (int, error) {
	for {
		if d.eof {
			return 0, io.EOF
		}
		n, err := d.decoder.Read(samples)
		d.applyEqualizer(samples[:n])
		d.frame += int64(n / d.Channels())
		if !errors.Is(err, io.EOF) || d.source == nil {
			return n, err
		}
		if n > 0 {
			return n, nil
		}
		if err := d.waitForData(); err != nil {
			return 0, err
		}
		if err := d.SetPosition(d.frame); err != nil {
			return 0, err
		}
	}
}

func (d *opusDecoder) waitForData() error {
	d.sb.mu.Lock()
	defer d.sb.mu.Unlock()
	for len(d.sb.data) <= d.indexedBytes && !d.sb.done {
		d.sb.waiting.Add(1)
		d.sb.cond.Wait()
		d.sb.waiting.Add(-1)
	}
	if len(d.sb.data) > d.indexedBytes {
		return nil
	}
	return d.sb.err
}

func (d *opusDecoder) index() (bool, error) {
	d.sb.mu.Lock()
	data, done := d.sb.data, d.sb.done
	d.sb.mu.Unlock()
	if len(data) != d.indexedBytes {
		source, err := puropus.ReadPackets(bytes.NewReader(data))
		if err != nil && (done || !errors.Is(err, puropus.ErrTruncated)) {
			return done, err
		}
		d.source, d.indexedBytes = &source, len(data)
	}
	return done, nil
}

func (d *opusDecoder) SetPosition(frame int64) error {
	frame = max(0, frame)
	complete := false
	if d.decoder != nil {
		var err error
		complete, err = d.index()
		if err != nil {
			return err
		}
		for frame > 0 && time.Duration(frame)*time.Second/time.Duration(d.SampleRate()) >= d.source.Duration() && !complete {
			if err := d.waitForData(); err != nil {
				return err
			}
			complete, err = d.index()
			if err != nil {
				return err
			}
		}
	}
	var decoder *puropus.Decoder
	var err error
	skip := frame
	if d.source != nil && frame > 0 {
		rate := int64(d.SampleRate())
		target := time.Duration(frame) * time.Second / time.Duration(rate)
		if target >= d.source.Duration() {
			d.frame, d.eof = frame, true
			return nil
		}
		cut, err := puropus.Cut(*d.source, puropus.Edit{Keep: []puropus.Interval{{Start: max(0, target-80*time.Millisecond), End: d.source.Duration()}}})
		if err != nil {
			return err
		}
		for _, span := range cut.Spans {
			if !span.Synthetic {
				skip = frame + int64(math.Round(span.Out.Seconds()*float64(rate))) - int64(math.Round(span.In.Seconds()*float64(rate)))
				break
			}
		}
		var encoded bytes.Buffer
		if err := cut.WriteOgg(&encoded); err != nil {
			return err
		}
		decoder, err = puropus.NewDecoder(bytes.NewReader(encoded.Bytes()), puropus.DecodeOptions{})
	} else if d.decoder != nil && !d.eof && frame >= d.frame {
		decoder, skip = d.decoder, frame-d.frame
	} else {
		decoder, err = puropus.NewDecoder(&streamBufferReader{sb: d.sb}, puropus.DecodeOptions{})
	}
	if err != nil {
		return err
	}
	samples := skip * int64(decoder.Channels())
	buffer := make([]float32, 4096)
	for samples > 0 {
		n, err := decoder.Read(buffer[:min(int64(len(buffer)), samples)])
		samples -= int64(n)
		if err != nil {
			return err
		}
		if n == 0 {
			return fmt.Errorf("decoder made no progress")
		}
	}
	d.decoder, d.frame, d.eof = decoder, frame, false
	d.eqPreset = -1
	return nil
}

func (d *opusDecoder) Close() error { return d.sb.Close() }
