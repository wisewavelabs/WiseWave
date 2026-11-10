package handlers

import (
	"math/rand"
	"sort"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
	"wisewave-runtime/internal/models"
)

type discoverSeed struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Artist string `json:"artist"`
	Genre  string `json:"genre"`
}

type discoverRequest struct {
	Seeds            []discoverSeed     `json:"seeds"`
	ArtistAffinities map[string]float64 `json:"artist_affinities"`
	Genres           []string           `json:"genres"`
	Heard            []string           `json:"heard"`
	Shown            []string           `json:"shown"`
	Excluded         []string           `json:"excluded"`
	Saved            []string           `json:"saved"`
	Surprise         bool               `json:"surprise"`
	Limit            int                `json:"limit"`
}

type discoverCandidate struct {
	track      models.Track
	score      float64
	sources    int
	similarity float64
}

func (h *TrackHandler) Discover(c *fiber.Ctx) error {
	request := discoverRequest{Limit: 8}
	if err := c.BodyParser(&request); err != nil {
		return fiber.ErrBadRequest
	}
	if request.Limit < 1 || request.Limit > 24 {
		request.Limit = 8
	}

	genres := request.Genres
	if len(genres) == 0 {
		genres = []string{"pop", "hip hop", "indie", "electronic", "r&b", "rock"}
	}
	queries := discoverQueries(request, genres)
	type result struct {
		weight float64
		tracks []models.Track
	}
	results := make(chan result, len(queries)+3)
	var wait sync.WaitGroup
	for _, seed := range request.Seeds[:min(3, len(request.Seeds))] {
		id := strings.TrimPrefix(strings.TrimPrefix(seed.ID, "youtube:"), "yt:")
		if id == "" || strings.Contains(id, ":") {
			continue
		}
		wait.Add(1)
		go func(id string) {
			defer wait.Done()
			tracks, err := h.tube.Related(id)
			if err == nil && len(tracks) > 0 {
				results <- result{weight: 4.8, tracks: tracks}
			}
		}(id)
	}
	for _, query := range queries {
		wait.Add(1)
		go func(query string, weight float64) {
			defer wait.Done()
			tracks, err := h.tube.Search(query)
			if err == nil {
				results <- result{weight: weight, tracks: tracks}
			}
		}(query.text, query.weight)
	}
	wait.Wait()
	close(results)

	blocked := stringSet(request.Heard, request.Shown, request.Excluded)
	saved := stringSet(request.Saved)
	candidates := map[string]*discoverCandidate{}
	for result := range results {
		for _, track := range result.tracks {
			if track.ID == "" || blocked[track.ID] {
				continue
			}
			candidate := candidates[track.ID]
			if candidate == nil {
				candidate = &discoverCandidate{track: track}
				candidates[track.ID] = candidate
			}
			candidate.score += result.weight
			candidate.sources++
			candidate.similarity = max(candidate.similarity, discoverSimilarity(track, request.Seeds))
		}
	}

	ranked := make([]*discoverCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		artistAffinity := request.ArtistAffinities[strings.ToLower(candidate.track.Artist)]
		candidate.score += float64(candidate.sources-1)*1.4 + candidate.similarity*2.2 + artistAffinity*1.8 + rand.Float64()*0.35
		if saved[candidate.track.ID] {
			candidate.score -= 1.25
		}
		if request.Surprise {
			candidate.score = rand.Float64()*4 + candidate.score*0.2
		}
		ranked = append(ranked, candidate)
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })

	artistCounts := map[string]int{}
	tracks := make([]models.Track, 0, request.Limit)
	for _, candidate := range ranked {
		artist := strings.ToLower(candidate.track.Artist)
		if artistCounts[artist] >= 2 {
			continue
		}
		tracks = append(tracks, candidate.track)
		artistCounts[artist]++
		if len(tracks) == request.Limit {
			break
		}
	}

	return c.JSON(fiber.Map{"data": tracks, "total": len(tracks), "has_more": len(ranked) > len(tracks)})
}

type weightedQuery struct {
	text   string
	weight float64
}

func discoverQueries(request discoverRequest, genres []string) []weightedQuery {
	queries := make([]weightedQuery, 0, 7)
	seedLimit := min(3, len(request.Seeds))
	for _, seed := range request.Seeds[:seedLimit] {
		queries = append(queries, weightedQuery{seed.Title + " " + seed.Artist, 3.2})
	}
	artists := make([]string, 0, len(request.ArtistAffinities))
	for artist := range request.ArtistAffinities {
		artists = append(artists, artist)
	}
	sort.Slice(artists, func(i, j int) bool {
		return request.ArtistAffinities[artists[i]] > request.ArtistAffinities[artists[j]]
	})
	for _, artist := range artists[:min(2, len(artists))] {
		queries = append(queries, weightedQuery{artist + " songs", 2.4})
	}
	rand.Shuffle(len(genres), func(i, j int) { genres[i], genres[j] = genres[j], genres[i] })
	for _, genre := range genres[:min(2, len(genres))] {
		variants := []string{" new releases", " hidden gems", " essentials", " discoveries", " fresh tracks", " music"}
		queries = append(queries, weightedQuery{genre + variants[rand.Intn(len(variants))], 1.5})
	}
	return queries
}

func stringSet(groups ...[]string) map[string]bool {
	result := map[string]bool{}
	for _, group := range groups {
		for _, value := range group {
			result[value] = true
		}
	}
	return result
}

func discoverSimilarity(track models.Track, seeds []discoverSeed) float64 {
	best := 0.0
	for _, seed := range seeds {
		score := 0.0
		if strings.EqualFold(track.Artist, seed.Artist) {
			score += 0.75
		}
		for _, word := range strings.Fields(strings.ToLower(seed.Title)) {
			if len(word) > 2 && strings.Contains(strings.ToLower(track.Title), word) {
				score += 0.1
			}
		}
		best = max(best, min(score, 1.0))
	}
	return best
}
