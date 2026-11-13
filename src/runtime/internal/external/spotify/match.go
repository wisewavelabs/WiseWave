package spotify

import (
	"math"
	"regexp"
	"strings"
	"unicode"
)

var (
	featPattern     = regexp.MustCompile(`(?i)\(feat\..*?\)`)
	ftPattern       = regexp.MustCompile(`(?i)\(ft\..*?\)`)
	bracketPattern  = regexp.MustCompile(`\[.*?\]`)
	remasterPattern = regexp.MustCompile(`(?i)\(.*?remaster.*?\)`)
	remixPattern    = regexp.MustCompile(`(?i)\(.*?remix.*?\)`)
	multiSpace      = regexp.MustCompile(`\s+`)
)

func NormalizeText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = featPattern.ReplaceAllString(value, " ")
	value = ftPattern.ReplaceAllString(value, " ")
	value = bracketPattern.ReplaceAllString(value, " ")
	value = remasterPattern.ReplaceAllString(value, " ")
	value = remixPattern.ReplaceAllString(value, " ")
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsSpace(r) {
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(multiSpace.ReplaceAllString(b.String(), " "))
}

func MatchScore(spotifyTitle, spotifyArtist string, spotifyDurationMs int, candidateTitle, candidateArtist string, candidateDurationSec int) float64 {
	titleA := NormalizeText(spotifyTitle)
	titleB := NormalizeText(candidateTitle)
	artistA := NormalizeText(spotifyArtist)
	artistB := NormalizeText(candidateArtist)
	if titleA == "" || titleB == "" {
		return 0
	}
	titleScore := stringSimilarity(titleA, titleB)
	artistScore := stringSimilarity(artistA, artistB)
	durationScore := 0.5
	if spotifyDurationMs > 0 && candidateDurationSec > 0 {
		diff := math.Abs(float64(spotifyDurationMs)/1000 - float64(candidateDurationSec))
		switch {
		case diff <= 2:
			durationScore = 1
		case diff <= 5:
			durationScore = 0.8
		case diff <= 10:
			durationScore = 0.5
		case diff <= 30:
			durationScore = 0.2
		default:
			durationScore = 0
		}
	}
	return titleScore*0.45 + artistScore*0.35 + durationScore*0.2
}

func stringSimilarity(a, b string) float64 {
	if a == b {
		return 1
	}
	if a == "" || b == "" {
		return 0
	}
	ba := bigrams(a)
	bb := bigrams(b)
	if len(ba) == 0 || len(bb) == 0 {
		return 0
	}
	overlap := 0
	for g := range ba {
		if bb[g] {
			overlap++
		}
	}
	return (2 * float64(overlap)) / float64(len(ba)+len(bb))
}

func bigrams(value string) map[string]bool {
	value = strings.ReplaceAll(value, " ", "")
	out := make(map[string]bool)
	if len(value) < 2 {
		return out
	}
	for i := 0; i+1 < len(value); i++ {
		out[value[i:i+2]] = true
	}
	return out
}
