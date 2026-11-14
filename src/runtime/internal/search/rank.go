package search

import (
	"math"
	"sort"
	"strings"
	"wisewave-runtime/internal/models"
)

type Weights struct{ Title, Artist, Coverage, Album, Provider, Preference float64 }

var DefaultWeights = Weights{.42, .25, .10, .10, .08, .05}

type Ranker struct {
	Weights    Weights
	Preference func(models.Track) float64
}
type Result struct {
	Track models.Track
	Score float64
}

func unit(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return max(0, min(1, v))
}

func relevance(q, f []string, full string) float64 {
	if len(f) == 0 {
		return 0
	}

	s := coverage(q, f)*.65 + coverage(f, q)*.35
	if strings.Join(q, " ") == strings.Join(f, " ") {
		return 1
	}
	if strings.Contains(full, strings.Join(f, " ")) {
		s = max(s, .95)
	}

	if len(q) > 1 {
		adjacent := 0
		for i := 0; i+1 < len(q); i++ {
			for j := 0; j+1 < len(f); j++ {
				if q[i] == f[j] && q[i+1] == f[j+1] {
					adjacent++
					break
				}
			}
		}
		s = min(1, s+.04*float64(adjacent)/float64(len(q)-1))
	}
	return s
}

func (r Ranker) Rank(query string, tracks []models.Track) []Result {
	q := Normalize(query)
	qt := tokens(q)
	out := make([]Result, 0, len(tracks))
	if len(qt) == 0 {
		return out
	}
	w := r.Weights
	if w == (Weights{}) {
		w = DefaultWeights
	}
	w.Title, w.Artist, w.Coverage, w.Album, w.Provider, w.Preference = unit(w.Title), unit(w.Artist), unit(w.Coverage), unit(w.Album), unit(w.Provider), unit(w.Preference)
	sum := w.Title + w.Artist + w.Coverage + w.Album + w.Provider + w.Preference
	if sum == 0 {
		sum = 1
	}
	for i, t := range tracks {
		title, artist, album := Normalize(t.Title), Normalize(t.Artist), Normalize(t.Album)
		tt, at, al := tokens(title), tokens(artist), tokens(album)
		combined := append(append(append([]string{}, tt...), at...), al...)
		cov := coverage(qt, combined)
		pref := 0.0
		if r.Preference != nil {
			pref = unit(r.Preference(t))
		} else if t.IsFavorite {
			pref = 1
		}
		score := (w.Title*relevance(qt, tt, q) + w.Artist*relevance(qt, at, q) + w.Coverage*cov + w.Album*relevance(qt, al, q) + w.Provider/(1+float64(i)*.05) + w.Preference*pref) / sum

		score *= cov * cov
		if coverage(qt, append(append([]string{}, tt...), at...)) == 1 {
			score += .18
		}
		if strings.Join(qt, " ") == strings.Join(tt, " ") {
			score += .12
		}
		if versions(q) != versions(title) {
			score *= .65
		}
		out = append(out, Result{t, unit(score)})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	return deduplicate(out)
}

func (r Ranker) Tracks(query string, tracks []models.Track) []models.Track {
	results := r.Rank(query, tracks)
	out := make([]models.Track, 0, len(results))
	for _, item := range results {
		out = append(out, item.Track)
	}
	return out
}
