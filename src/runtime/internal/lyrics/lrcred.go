package lyrics

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type LrcRedProvider struct {
	httpClient *http.Client
}

func NewLrcRedProvider() *LrcRedProvider {
	return &LrcRedProvider{
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (l *LrcRedProvider) Name() string {
	return "lrcred"
}

type lrcRedHit struct {
	ISRC     string  `json:"isrc"`
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Duration float64 `json:"duration"`
	Sync     string  `json:"sync"`
}

type lrcRedSearchResponse struct {
	Hits []lrcRedHit `json:"hits"`
}

func (l *LrcRedProvider) Fetch(meta TrackMeta) (*LyricsDocument, error) {
	if meta.ISRC != "" {
		doc, err := l.fetchByISRC(meta.ISRC, meta)
		if err == nil && doc != nil && len(doc.Lines) > 0 {
			return doc, nil
		}
	}

	if meta.Title == "" {
		return nil, fmt.Errorf("title is required")
	}

	query := meta.Title
	if meta.Artist != "" {
		query = fmt.Sprintf("%s %s", meta.Title, meta.Artist)
	}

	searchURL := fmt.Sprintf("https://lrc.red/search.json?q=%s", url.QueryEscape(query))
	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "WiseWave/1.0 (https://wisewave.me)")

	resp, err := l.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lrc.red search returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var searchResp lrcRedSearchResponse
	if err := json.Unmarshal(body, &searchResp); err != nil {
		return nil, err
	}

	if len(searchResp.Hits) == 0 {
		return nil, fmt.Errorf("no lrc.red hits found")
	}

	for _, hit := range searchResp.Hits {
		if hit.ISRC == "" {
			continue
		}
		doc, err := l.fetchByISRC(hit.ISRC, TrackMeta{
			Title:           hit.Title,
			Artist:          hit.Artist,
			DurationSeconds: int(hit.Duration),
			ISRC:            hit.ISRC,
		})
		if err == nil && doc != nil && len(doc.Lines) > 0 {
			return doc, nil
		}
	}

	return nil, fmt.Errorf("no matching lrc.red lyrics found")
}

func (l *LrcRedProvider) fetchByISRC(isrc string, meta TrackMeta) (*LyricsDocument, error) {
	cleanISRC := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(isrc), "-", ""))

	ttmlURL := fmt.Sprintf("https://lrc.red/s/%s.ttml", cleanISRC)
	ttmlReq, err := http.NewRequest("GET", ttmlURL, nil)
	if err == nil {
		ttmlReq.Header.Set("User-Agent", "WiseWave/1.0 (https://wisewave.me)")
		resp, err := l.httpClient.Do(ttmlReq)
		if err == nil && resp.StatusCode == http.StatusOK {
			defer resp.Body.Close()
			ttmlBytes, err := io.ReadAll(resp.Body)
			if err == nil && len(ttmlBytes) > 0 {
				lines, _, parseErr := ParseTtml(string(ttmlBytes))
				if parseErr == nil && len(lines) > 0 {
					return &LyricsDocument{
						Source:       "lrcred",
						SourceURL:    "https://lrc.red/s/" + cleanISRC,
						Type:         "syllable",
						TrackName:    meta.Title,
						ArtistName:   meta.Artist,
						Duration:     float64(meta.DurationSeconds),
						SyncedLyrics: BuildSyncedLrc(lines),
						PlainLyrics:  BuildPlainLyrics(lines),
						Lines:        lines,
					}, nil
				}
			}
		}
	}

	lrcURL := fmt.Sprintf("https://lrc.red/s/%s.lrc", cleanISRC)
	lrcReq, err := http.NewRequest("GET", lrcURL, nil)
	if err != nil {
		return nil, err
	}
	lrcReq.Header.Set("User-Agent", "WiseWave/1.0 (https://wisewave.me)")

	resp, err := l.httpClient.Do(lrcReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lrc.red returned %d for %s", resp.StatusCode, cleanISRC)
	}

	lrcBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	lines := ParseLrcRedLyrics(string(lrcBytes))
	if len(lines) == 0 {
		return nil, fmt.Errorf("failed to parse lrc.red lyrics")
	}

	docType := "line"
	for _, line := range lines {
		if len(line.Syllables) > 0 {
			docType = "syllable"
			break
		}
	}

	return &LyricsDocument{
		Source:       "lrcred",
		SourceURL:    "https://lrc.red/s/" + cleanISRC,
		Type:         docType,
		TrackName:    meta.Title,
		ArtistName:   meta.Artist,
		Duration:     float64(meta.DurationSeconds),
		SyncedLyrics: BuildSyncedLrc(lines),
		PlainLyrics:  BuildPlainLyrics(lines),
		Lines:        lines,
	}, nil
}

var wordTimestampPattern = regexp.MustCompile(`<(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)>`)

func ParseLrcRedLyrics(content string) []Line {
	rawLines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	var lines []Line

	for _, rawLine := range rawLines {
		rawLine = strings.TrimSpace(rawLine)
		if rawLine == "" || strings.HasPrefix(rawLine, "[offset:") {
			continue
		}

		lineTsMatch := lrcTimestampPattern.FindString(rawLine)
		if lineTsMatch == "" {
			continue
		}

		lineStartMs, ok := ParseLrcTimestamp(lineTsMatch)
		if !ok {
			continue
		}

		cleanedLine := strings.TrimSpace(rawLine[len(lineTsMatch):])
		wordMatches := wordTimestampPattern.FindAllStringSubmatchIndex(cleanedLine, -1)

		if len(wordMatches) < 2 {
			pureText := strings.TrimSpace(wordTimestampPattern.ReplaceAllString(cleanedLine, ""))
			lines = append(lines, Line{
				StartTimeMs: lineStartMs,
				Text:        pureText,
			})
			continue
		}

		var syllables []Syllable
		var lineText strings.Builder

		for i := 0; i < len(wordMatches)-1; i++ {
			currStart := wordMatches[i][2]
			currEnd := wordMatches[i][3]
			currTsStr := cleanedLine[currStart:currEnd]

			nextStart := wordMatches[i+1][2]
			nextEnd := wordMatches[i+1][3]
			nextTsStr := cleanedLine[nextStart:nextEnd]

			startMs, okStart := ParseLrcTimestamp("[" + currTsStr + "]")
			endMs, okEnd := ParseLrcTimestamp("[" + nextTsStr + "]")
			if !okStart || !okEnd || endMs <= startMs {
				continue
			}

			sylText := cleanedLine[wordMatches[i][1]:wordMatches[i+1][0]]
			if strings.TrimSpace(sylText) == "" {
				continue
			}

			syllables = append(syllables, Syllable{
				StartTimeMs: startMs,
				EndTimeMs:   endMs,
				Text:        sylText,
			})
			lineText.WriteString(sylText)
		}

		finalText := strings.TrimSpace(lineText.String())
		if finalText == "" {
			finalText = strings.TrimSpace(wordTimestampPattern.ReplaceAllString(cleanedLine, ""))
		}

		if finalText != "" {
			lines = append(lines, Line{
				StartTimeMs: lineStartMs,
				Text:        finalText,
				Syllables:   syllables,
			})
		}
	}

	return lines
}
