package lyrics

import (
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type KugouProvider struct {
	httpClient *http.Client
}

func NewKugouProvider() *KugouProvider {
	return &KugouProvider{
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (k *KugouProvider) Name() string {
	return "kugou"
}

type kugouCandidate struct {
	ID       int64   `json:"id"`
	Token    string  `json:"accesskey"`
	Song     string  `json:"song"`
	Singer   string  `json:"singer"`
	Duration float64 `json:"duration"`
}

type kugouSearchResponse struct {
	Status     int              `json:"status"`
	Candidates []kugouCandidate `json:"candidates"`
}

type kugouDownloadResponse struct {
	Status  int    `json:"status"`
	Fmt     string `json:"fmt"`
	Content string `json:"content"`
}

func (k *KugouProvider) Fetch(meta TrackMeta) (*LyricsDocument, error) {
	if meta.Title == "" {
		return nil, fmt.Errorf("title is required")
	}

	keyword := meta.Title
	if meta.Artist != "" {
		keyword = fmt.Sprintf("%s - %s", meta.Artist, meta.Title)
	}

	searchURL, err := url.Parse("https://lyrics.kugou.com/search")
	if err != nil {
		return nil, err
	}

	q := searchURL.Query()
	q.Set("ver", "1")
	q.Set("man", "yes")
	q.Set("client", "pc")
	q.Set("keyword", keyword)
	if meta.DurationSeconds > 0 {
		q.Set("duration", strconv.Itoa(meta.DurationSeconds))
	}
	q.Set("hash", "")
	searchURL.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", searchURL.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "WiseWave/1.0 (Android; Kugou)")

	resp, err := k.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("kugou search returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var searchResp kugouSearchResponse
	if err := json.Unmarshal(body, &searchResp); err != nil {
		return nil, err
	}

	if len(searchResp.Candidates) == 0 {
		return nil, fmt.Errorf("no kugou candidates found")
	}

	candidates := searchResp.Candidates
	if meta.DurationSeconds > 0 {
		targetDuration := float64(meta.DurationSeconds)
		sort.Slice(candidates, func(i, j int) bool {
			return math.Abs(candidates[i].Duration-targetDuration) < math.Abs(candidates[j].Duration-targetDuration)
		})
	}

	for _, cand := range candidates {
		if cand.ID == 0 || cand.Token == "" {
			continue
		}

		doc, err := k.downloadCandidate(cand)
		if err == nil && doc != nil && len(doc.Lines) > 0 {
			return doc, nil
		}
	}

	return nil, fmt.Errorf("kugou lyrics parsing failed")
}

func (k *KugouProvider) downloadCandidate(cand kugouCandidate) (*LyricsDocument, error) {
	dlURL, err := url.Parse("https://lyrics.kugou.com/download")
	if err != nil {
		return nil, err
	}

	q := dlURL.Query()
	q.Set("ver", "1")
	q.Set("client", "pc")
	q.Set("id", strconv.FormatInt(cand.ID, 10))
	q.Set("accesskey", cand.Token)
	q.Set("fmt", "krc")
	q.Set("charset", "utf8")
	dlURL.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", dlURL.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "WiseWave/1.0 (Android; Kugou)")

	resp, err := k.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("kugou download returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var dlResp kugouDownloadResponse
	if err := json.Unmarshal(body, &dlResp); err != nil {
		return nil, err
	}

	if dlResp.Content == "" {
		return nil, fmt.Errorf("empty kugou content")
	}

	krcText, err := DecodeKrc(dlResp.Content)
	if err != nil {
		return nil, err
	}

	lines := ParseKrcLines(krcText)
	if len(lines) == 0 {
		return nil, fmt.Errorf("no parsed krc lines")
	}

	synced := BuildSyncedLrc(lines)
	plain := BuildPlainLyrics(lines)

	return &LyricsDocument{
		Source:       "kugou",
		Type:         "syllable",
		TrackName:    cand.Song,
		ArtistName:   cand.Singer,
		Duration:     cand.Duration,
		SyncedLyrics: synced,
		PlainLyrics:  plain,
		Lines:        lines,
	}, nil
}

func DecodeKrc(content string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(content))
	if err != nil {
		return "", err
	}

	if len(data) <= 4 || string(data[:4]) != "krc1" {
		return "", fmt.Errorf("invalid krc header")
	}

	matrix := assembleMatrix()
	compressed := data[4:]
	for i := 0; i < len(compressed); i++ {
		compressed[i] ^= matrix[i%len(matrix)]
	}

	zReader, err := zlib.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return "", err
	}
	defer zReader.Close()

	decompressed, err := io.ReadAll(zReader)
	if err != nil {
		return "", err
	}

	return string(decompressed), nil
}

func assembleMatrix() []byte {
	seedMatrix := [...]byte{18, 43, 41, 67, 152, 38, 254, 59, 77, 122, 89, 61, 136, 182, 196, 153}
	assembled := make([]byte, 16)
	for i := 0; i < 16; i++ {
		stepA := byte(((i*41 + 0x67) * 19) & 0xFF)
		stepC := byte(((i*73 + 0x3B) * 11) & 0xFF)
		val := byte(((int(stepA) ^ int(seedMatrix[i])) + int(stepC)) & 0xFF)
		assembled[i] = val
	}
	return assembled
}

var krcLinePattern = regexp.MustCompile(`^\[(\d+),(\d+)\](.*)$`)
var krcSyllablePattern = regexp.MustCompile(`<(\d+),(\d+),\d+>([^<]*)`)

func ParseKrcLines(text string) []Line {
	rawLines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	var lines []Line

	for _, rawLine := range rawLines {
		rawLine = strings.TrimSpace(rawLine)
		if rawLine == "" || strings.HasPrefix(rawLine, "[offset:") {
			continue
		}

		match := krcLinePattern.FindStringSubmatch(rawLine)
		if match == nil {
			continue
		}

		startTimeMs, err := strconv.ParseInt(match[1], 10, 64)
		if err != nil {
			continue
		}
		durationMs, err := strconv.ParseInt(match[2], 10, 64)
		if err != nil || durationMs <= 0 {
			continue
		}
		endTimeMs := startTimeMs + durationMs

		content := match[3]
		syllableMatches := krcSyllablePattern.FindAllStringSubmatch(content, -1)

		var syllables []Syllable
		var lineText strings.Builder

		for _, sylMatch := range syllableMatches {
			offsetMs, _ := strconv.ParseInt(sylMatch[1], 10, 64)
			durMs, _ := strconv.ParseInt(sylMatch[2], 10, 64)
			wordText := sylMatch[3]

			sylStart := startTimeMs + offsetMs
			sylEnd := sylStart + durMs

			syllables = append(syllables, Syllable{
				StartTimeMs: sylStart,
				EndTimeMs:   sylEnd,
				Text:        wordText,
			})
			lineText.WriteString(wordText)
		}

		finalText := strings.TrimSpace(lineText.String())
		lines = append(lines, Line{
			StartTimeMs: startTimeMs,
			EndTimeMs:   endTimeMs,
			Text:        finalText,
			Syllables:   syllables,
		})
	}

	return lines
}
