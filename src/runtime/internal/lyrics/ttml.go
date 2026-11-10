package lyrics

import (
	"encoding/xml"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
)

var offsetTimePattern = regexp.MustCompile(`^(\d+(?:\.\d+)?)(ms|s|m|h)?$`)
var clockTimePattern = regexp.MustCompile(`^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$`)

func ParseTtmlTime(text string) (int64, bool) {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0, false
	}

	if match := offsetTimePattern.FindStringSubmatch(text); match != nil {
		val, err := strconv.ParseFloat(match[1], 64)
		if err != nil {
			return 0, false
		}
		unit := match[2]
		var multiplier float64
		switch unit {
		case "ms":
			multiplier = 1
		case "m":
			multiplier = 60000
		case "h":
			multiplier = 3600000
		default:
			multiplier = 1000
		}
		return int64(val * multiplier), true
	}

	if match := clockTimePattern.FindStringSubmatch(text); match != nil {
		var hours int64
		if match[1] != "" {
			hours, _ = strconv.ParseInt(match[1], 10, 64)
		}
		minutes, err := strconv.ParseInt(match[2], 10, 64)
		if err != nil || minutes >= 60 {
			return 0, false
		}
		secFloat, err := strconv.ParseFloat(match[3], 64)
		if err != nil || secFloat >= 60 {
			return 0, false
		}
		totalMs := (hours*3600+minutes*60)*1000 + int64(secFloat*1000)
		return totalMs, true
	}

	return 0, false
}

type TtmlMetadata struct {
	MusicName []string
	Artists   []string
	ISRC      []string
	SpotifyID []string
}

func ParseTtml(xmlContent string) ([]Line, *TtmlMetadata, error) {
	decoder := xml.NewDecoder(strings.NewReader(xmlContent))
	meta := &TtmlMetadata{}
	var lines []Line

	var currentLine *Line
	type spanState struct {
		syllable        Syllable
		background      bool
		children        bool
		backgroundStart int
	}
	var spans []spanState
	var background []Syllable
	var inP bool
	var timedLine bool
	var pText strings.Builder

	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, nil, err
		}

		switch elem := token.(type) {
		case xml.StartElement:
			localName := strings.ToLower(elem.Name.Local)
			if localName == "meta" {
				var key, value string
				for _, attr := range elem.Attr {
					attrLocal := strings.ToLower(attr.Name.Local)
					switch attrLocal {
					case "key":
						key = attr.Value
					case "value":
						value = attr.Value
					}
				}
				if key != "" && value != "" {
					switch key {
					case "musicName":
						meta.MusicName = append(meta.MusicName, value)
					case "artists":
						meta.Artists = append(meta.Artists, value)
					case "isrc":
						meta.ISRC = append(meta.ISRC, value)
					case "spotifyId":
						meta.SpotifyID = append(meta.SpotifyID, value)
					}
				}
			} else if localName == "p" {
				inP = true
				timedLine = false
				pText.Reset()
				spans = nil
				background = nil
				var startMs, endMs int64
				for _, attr := range elem.Attr {
					attrLocal := strings.ToLower(attr.Name.Local)
					switch attrLocal {
					case "begin":
						startMs, timedLine = ParseTtmlTime(attr.Value)
					case "end":
						endMs, _ = ParseTtmlTime(attr.Value)
					}
				}
				currentLine = &Line{
					StartTimeMs: startMs,
					EndTimeMs:   endMs,
				}
				for _, attr := range elem.Attr {
					if strings.ToLower(attr.Name.Local) == "role" && (attr.Value == "x-bg" || attr.Value == "background") {
						currentLine.IsBackground = true
					}
				}
			} else if localName == "span" && inP {
				span := spanState{syllable: Syllable{StartTimeMs: currentLine.StartTimeMs, EndTimeMs: currentLine.EndTimeMs}, backgroundStart: len(background)}
				if len(spans) > 0 {
					span.syllable.StartTimeMs = spans[len(spans)-1].syllable.StartTimeMs
					span.syllable.EndTimeMs = spans[len(spans)-1].syllable.EndTimeMs
					spans[len(spans)-1].children = true
					span.background = spans[len(spans)-1].background
				}
				for _, attr := range elem.Attr {
					switch strings.ToLower(attr.Name.Local) {
					case "begin":
						span.syllable.StartTimeMs, _ = ParseTtmlTime(attr.Value)
					case "end":
						span.syllable.EndTimeMs, _ = ParseTtmlTime(attr.Value)
					case "role":
						span.background = span.background || attr.Value == "x-bg" || attr.Value == "background"
					}
				}
				spans = append(spans, span)
			}
		case xml.EndElement:
			localName := strings.ToLower(elem.Name.Local)
			if localName == "span" && len(spans) > 0 {
				span := spans[len(spans)-1]
				spans = spans[:len(spans)-1]
				if !span.children && strings.TrimSpace(span.syllable.Text) != "" && currentLine != nil {
					if span.background {
						span.syllable.IsBackground = true
						background = append(background, span.syllable)
					} else {
						currentLine.Syllables = append(currentLine.Syllables, span.syllable)
					}
				}
			} else if localName == "p" && inP {
				inP = false
				if currentLine != nil {
					currentLine.Text = strings.TrimSpace(pText.String())
					if currentLine.Text != "" || timedLine {
						lines = append(lines, *currentLine)
					}
					if len(background) > 0 {
						var text strings.Builder
						for _, word := range background {
							text.WriteString(word.Text)
						}
						lines = append(lines, Line{StartTimeMs: background[0].StartTimeMs, EndTimeMs: background[len(background)-1].EndTimeMs, Text: strings.TrimSpace(text.String()), IsBackground: true, Syllables: background})
					}
				}
				currentLine = nil
			}
		case xml.CharData:
			if inP {
				text := string(elem)
				if len(spans) > 0 {
					span := &spans[len(spans)-1]
					span.syllable.Text += text
					if span.background && span.children && strings.TrimSpace(text) == "" && len(background) > span.backgroundStart {
						background[len(background)-1].Text += text
					}
				}
				if len(spans) == 0 || !spans[len(spans)-1].background {
					pText.WriteString(text)
				}
			}
		}
	}

	return lines, meta, nil
}

func GenerateTtml(title, artist string, lines []Line) string {
	var sb strings.Builder
	sb.WriteString("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n")
	sb.WriteString("<tt xmlns=\"http://www.w3.org/ns/ttml\" xmlns:ttm=\"http://www.w3.org/ns/ttml#metadata\">\n")
	sb.WriteString("  <head>\n")
	sb.WriteString("    <metadata>\n")
	if title != "" {
		sb.WriteString(fmt.Sprintf("      <ttm:title>%s</ttm:title>\n", xmlEscape(title)))
	}
	if artist != "" {
		sb.WriteString(fmt.Sprintf("      <ttm:agent type=\"person\">%s</ttm:agent>\n", xmlEscape(artist)))
	}
	sb.WriteString("    </metadata>\n")
	sb.WriteString("  </head>\n")
	sb.WriteString("  <body>\n")
	sb.WriteString("    <div>\n")
	for _, line := range lines {
		begin := formatTtmlTime(line.StartTimeMs)
		end := formatTtmlTime(line.EndTimeMs)
		sb.WriteString(fmt.Sprintf("      <p begin=\"%s\" end=\"%s\">\n", begin, end))
		if len(line.Syllables) > 0 {
			for _, syl := range line.Syllables {
				sBegin := formatTtmlTime(syl.StartTimeMs)
				sEnd := formatTtmlTime(syl.EndTimeMs)
				sb.WriteString(fmt.Sprintf("        <span begin=\"%s\" end=\"%s\">%s</span>\n", sBegin, sEnd, xmlEscape(syl.Text)))
			}
		} else {
			sb.WriteString(fmt.Sprintf("        <span>%s</span>\n", xmlEscape(line.Text)))
		}
		sb.WriteString("      </p>\n")
	}
	sb.WriteString("    </div>\n")
	sb.WriteString("  </body>\n")
	sb.WriteString("</tt>\n")
	return sb.String()
}

func formatTtmlTime(ms int64) string {
	if ms < 0 {
		ms = 0
	}
	minutes := ms / 60000
	seconds := (ms % 60000) / 1000
	millis := ms % 1000
	return fmt.Sprintf("%02d:%02d.%03d", minutes, seconds, millis)
}

func xmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	s = strings.ReplaceAll(s, "'", "&apos;")
	return s
}
