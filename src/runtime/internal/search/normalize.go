package search

import (
	"golang.org/x/text/unicode/norm"
	"strings"
	"unicode"
)

func Normalize(s string) string {
	var b strings.Builder
	latin := false
	for _, r := range norm.NFKD.String(strings.ToLower(s)) {
		if unicode.IsMark(r) {
			if !latin {
				b.WriteRune(r)
			}
			continue
		}
		latin = unicode.In(r, unicode.Latin)
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			b.WriteRune(r)
		} else {
			b.WriteByte(' ')
		}
	}
	words := strings.Fields(b.String())
	for i, w := range words {
		switch w {
		case "ft", "featuring":
			words[i] = "feat"
		case "remaster":
			words[i] = "remastered"
		}
	}
	value := " " + strings.Join(words, " ") + " "
	for _, alias := range [][2]string{{" a r rahman ", " ar rahman "}, {" a r rehman ", " ar rahman "}, {" ar rehman ", " ar rahman "}} {
		value = strings.ReplaceAll(value, alias[0], alias[1])
	}
	return strings.TrimSpace(value)
}

func tokens(s string) []string {
	var out []string
	words := strings.Fields(s)
	for _, w := range words {
		if w != "the" && w != "feat" {
			out = append(out, w)
		}
	}
	if len(out) == 0 {
		return words
	}
	return out
}

var versionWords = []string{"live", "acoustic", "remix", "remastered", "instrumental", "slowed", "sped up", "extended", "radio edit", "cover", "karaoke"}

func versions(s string) string {
	var found []string
	for _, v := range versionWords {
		if strings.Contains(" "+s+" ", " "+v+" ") {
			found = append(found, v)
		}
	}
	return strings.Join(found, "|")
}
