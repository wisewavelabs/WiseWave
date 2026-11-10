package desktop

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const audioCacheLimit int64 = 1 << 30
const audioCacheHeader = 56

type cachedAudio struct {
	data     []byte
	bitrate  int
	duration time.Duration
}

type audioCache struct {
	mu    sync.Mutex
	dir   string
	limit int64
}

func newAudioCache() (*audioCache, error) {
	root, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(root, "WiseWave", "audio")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	return &audioCache{dir: dir, limit: audioCacheLimit}, nil
}

func (c *audioCache) get(id string) (*cachedAudio, error) {
	if !videoID.MatchString(id) {
		return nil, errors.New("invalid audio cache key")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	path := filepath.Join(c.dir, id+".wwaudio")
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() <= audioCacheHeader || info.Size() > c.limit {
		return nil, errors.New("invalid cached audio size")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(content) <= audioCacheHeader || string(content[:4]) != "WWA1" {
		return nil, errors.New("invalid cached audio header")
	}
	data := content[audioCacheHeader:]
	digest := sha256.Sum256(data)
	if string(content[24:56]) != string(digest[:]) {
		return nil, errors.New("cached audio checksum mismatch")
	}
	bitrate := binary.LittleEndian.Uint32(content[4:8])
	duration := binary.LittleEndian.Uint64(content[8:16])
	length := binary.LittleEndian.Uint64(content[16:24])
	if uint64(len(data)) != length || bitrate == 0 || duration == 0 || duration > uint64((24*time.Hour)/time.Millisecond) {
		return nil, errors.New("invalid cached audio metadata")
	}
	now := time.Now()
	if err := os.Chtimes(path, now, now); err != nil {
		log.Printf("update audio cache age for %s: %v", id, err)
	}
	return &cachedAudio{data: data, bitrate: int(bitrate), duration: time.Duration(duration) * time.Millisecond}, nil
}

func (c *audioCache) remove(id string) error {
	if !videoID.MatchString(id) {
		return errors.New("invalid audio cache key")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	err := os.Remove(filepath.Join(c.dir, id+".wwaudio"))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

func (c *audioCache) put(id string, data []byte, bitrate int, duration time.Duration) error {
	if !videoID.MatchString(id) {
		return errors.New("invalid audio cache key")
	}
	if len(data) == 0 || int64(len(data))+audioCacheHeader > c.limit || bitrate <= 0 || duration <= 0 {
		return errors.New("invalid audio cache entry")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	path := filepath.Join(c.dir, id+".wwaudio")
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return err
	}
	type cacheFile struct {
		path     string
		size     int64
		modified time.Time
	}
	files := make([]cacheFile, 0, len(entries))
	var total int64
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".wwaudio") || !videoID.MatchString(strings.TrimSuffix(name, ".wwaudio")) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			continue
		}
		total += info.Size()
		files = append(files, cacheFile{path: filepath.Join(c.dir, name), size: info.Size(), modified: info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].modified.Before(files[j].modified) })
	for _, file := range files {
		if total+int64(len(data))+audioCacheHeader <= c.limit {
			break
		}
		if err := os.Remove(file.path); err != nil {
			return err
		}
		total -= file.size
	}
	file, err := os.CreateTemp(c.dir, ".audio-*.tmp")
	if err != nil {
		return err
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	header := make([]byte, audioCacheHeader)
	copy(header, "WWA1")
	binary.LittleEndian.PutUint32(header[4:8], uint32(bitrate))
	binary.LittleEndian.PutUint64(header[8:16], uint64(duration.Milliseconds()))
	binary.LittleEndian.PutUint64(header[16:24], uint64(len(data)))
	digest := sha256.Sum256(data)
	copy(header[24:56], digest[:])
	if _, err = file.Write(header); err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
