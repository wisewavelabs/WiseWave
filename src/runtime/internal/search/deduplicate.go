package search

import (
	"strconv"
	"strings"
	"wisewave-runtime/internal/models"
)

func sameRecording(a, b models.Track) bool {
	if a.ID != "" && a.ID == b.ID {
		return true
	}
	return a.Artist != "" && b.Artist != "" && a.Album != "" && b.Album != "" && a.DurationSeconds > 0 && a.DurationSeconds == b.DurationSeconds && Normalize(a.Title) != "" && Normalize(a.Title) == Normalize(b.Title) && Normalize(a.Artist) == Normalize(b.Artist) && Normalize(a.Album) == Normalize(b.Album) && (a.AlbumID == "" || b.AlbumID == "" || a.AlbumID == b.AlbumID)
}

func quality(t models.Track) int {
	n := 0
	for _, s := range []string{t.Title, t.Artist, t.ArtistID, t.Album, t.AlbumID, t.AlbumArtURL, t.Duration} {
		if s != "" {
			n++
		}
	}
	if t.DurationSeconds > 0 {
		n++
	}
	return n
}

func deduplicate(in []Result) []Result {
	out := make([]Result, 0, len(in))
	ids := make(map[string]int, len(in))
	metadata := make(map[string][]int, len(in))
	for _, item := range in {
		key := ""
		t := item.Track
		if t.Title != "" && t.Artist != "" && t.Album != "" && t.DurationSeconds > 0 {
			key = strings.Join([]string{Normalize(t.Title), Normalize(t.Artist), Normalize(t.Album), strconv.Itoa(t.DurationSeconds)}, "\x00")
		}
		candidates := metadata[key]
		if key == "" {
			candidates = nil
		}
		if index, ok := ids[t.ID]; ok && t.ID != "" {
			candidates = []int{index}
		}
		duplicate := false
		for _, i := range candidates {
			if sameRecording(out[i].Track, item.Track) {
				if out[i].Track.ID != "" && out[i].Track.ID == item.Track.ID {
					fillMetadata(&out[i].Track, item.Track)
				}
				if item.Score == out[i].Score && quality(item.Track) > quality(out[i].Track) {
					out[i] = item
				}
				duplicate = true
				break
			}
		}
		if !duplicate {
			if t.ID != "" {
				ids[t.ID] = len(out)
			}
			if key != "" {
				metadata[key] = append(metadata[key], len(out))
			}
			out = append(out, item)
		} else if t.ID != "" {

			for _, i := range candidates {
				if sameRecording(out[i].Track, t) {
					ids[t.ID] = i
					break
				}
			}
		}
	}
	return out
}

func fillMetadata(dst *models.Track, src models.Track) {
	pairs := []struct {
		dst *string
		src string
	}{
		{&dst.Title, src.Title}, {&dst.Artist, src.Artist}, {&dst.ArtistID, src.ArtistID},
		{&dst.Album, src.Album}, {&dst.AlbumID, src.AlbumID}, {&dst.AlbumArtURL, src.AlbumArtURL},
		{&dst.Duration, src.Duration}, {&dst.FilePath, src.FilePath}, {&dst.StreamURL, src.StreamURL},
	}
	for _, p := range pairs {
		if *p.dst == "" {
			*p.dst = p.src
		}
	}
	if dst.DurationSeconds == 0 {
		dst.DurationSeconds = src.DurationSeconds
	}
	dst.IsFavorite = dst.IsFavorite || src.IsFavorite
}
