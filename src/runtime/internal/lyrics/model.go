package lyrics

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

type Syllable struct {
	IsBackground     bool   `json:"is_background,omitempty"`
	AppendToPrevious bool   `json:"append_to_previous,omitempty"`
	StartTimeMs      int64  `json:"start_time_ms"`
	EndTimeMs        int64  `json:"end_time_ms"`
	Text             string `json:"text"`
}

type Line struct {
	Transliteration string     `json:"transliteration,omitempty"`
	IsBackground    bool       `json:"is_background,omitempty"`
	StartTimeMs     int64      `json:"start_time_ms"`
	EndTimeMs       int64      `json:"end_time_ms"`
	Text            string     `json:"text"`
	Syllables       []Syllable `json:"syllables,omitempty"`
}

type TrackMeta struct {
	VideoID         string
	Title           string
	Artist          string
	Album           string
	DurationSeconds int
	DurationMs      int64
	ISRC            string
	SpotifyID       string
}

type LyricsDocument struct {
	Source       string  `json:"source"`
	Type         string  `json:"type"`
	TrackName    string  `json:"track_name"`
	ArtistName   string  `json:"artist_name"`
	AlbumName    string  `json:"album_name,omitempty"`
	Duration     float64 `json:"duration,omitempty"`
	Instrumental bool    `json:"instrumental"`
	PlainLyrics  string  `json:"plain_lyrics"`
	SyncedLyrics string  `json:"synced_lyrics"`
	Lines        []Line  `json:"lines,omitempty"`
}

type Record struct {
	Refining     bool    `json:"refining,omitempty"`
	ID           int64   `json:"id,omitempty"`
	Source       string  `json:"source"`
	Type         string  `json:"type"`
	TrackName    string  `json:"track_name"`
	ArtistName   string  `json:"artist_name"`
	AlbumName    string  `json:"album_name"`
	Duration     float64 `json:"duration"`
	Instrumental bool    `json:"instrumental"`
	PlainLyrics  string  `json:"plain_lyrics"`
	SyncedLyrics string  `json:"synced_lyrics"`
	Lines        []Line  `json:"lines,omitempty"`
}

type Provider interface {
	Name() string
	Fetch(meta TrackMeta) (*LyricsDocument, error)
}

var TitleSanitizeRegex = regexp.MustCompile(`(?i)\s*[\(\[](feat\.|ft\.|official|video|audio|remastered|lyrics)[\s\S]*?[\)\]]`)

func SanitizeTitle(title string) string {
	return strings.TrimSpace(TitleSanitizeRegex.ReplaceAllString(title, ""))
}

func FormatTimestamp(milliseconds int64) string {
	if milliseconds < 0 {
		milliseconds = 0
	}
	minutes := milliseconds / 60000
	seconds := (milliseconds % 60000) / 1000
	hundredths := (milliseconds % 1000) / 10
	return fmt.Sprintf("[%02d:%02d.%02d]", minutes, seconds, hundredths)
}

var lrcTimestampPattern = regexp.MustCompile(`\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]`)

func ParseLrcTimestamp(val string) (int64, bool) {
	match := lrcTimestampPattern.FindStringSubmatch(val)
	if match == nil {
		return 0, false
	}
	minutes, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		return 0, false
	}
	seconds, err := strconv.ParseInt(match[2], 10, 64)
	if err != nil || seconds >= 60 {
		return 0, false
	}
	var fractionMs int64
	if len(match) > 3 && match[3] != "" {
		fracStr := match[3]
		if len(fracStr) == 1 {
			fracStr += "00"
		} else if len(fracStr) == 2 {
			fracStr += "0"
		} else if len(fracStr) > 3 {
			fracStr = fracStr[:3]
		}
		fractionMs, _ = strconv.ParseInt(fracStr, 10, 64)
	}
	return (minutes*60+seconds)*1000 + fractionMs, true
}

func BuildSyncedLrc(lines []Line) string {
	var builder strings.Builder
	for i, line := range lines {
		if strings.TrimSpace(line.Text) == "" {
			continue
		}
		if i > 0 {
			builder.WriteString("\n")
		}
		builder.WriteString(FormatTimestamp(line.StartTimeMs))
		builder.WriteString(" ")
		builder.WriteString(line.Text)
	}
	return builder.String()
}

func BuildPlainLyrics(lines []Line) string {
	var builder strings.Builder
	for i, line := range lines {
		if strings.TrimSpace(line.Text) == "" {
			continue
		}
		if i > 0 {
			builder.WriteString("\n")
		}
		builder.WriteString(line.Text)
	}
	return builder.String()
}
