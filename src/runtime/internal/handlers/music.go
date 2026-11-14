package handlers

import (
	"context"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"wisewave-runtime/internal/innertube"
)

var musicID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,160}$`)

func (h *TrackHandler) Music(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(c.UserContext(), 20*time.Second)
	defer cancel()

	client := h.tube.MusicClient
	id := strings.TrimSpace(c.Params("id"))
	query := strings.TrimSpace(c.Query("q"))
	token := strings.TrimSpace(c.Query("continuation"))
	if len(token) > 8192 || len(query) > 512 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	var data any
	var err error
	switch c.Params("kind") {
	case "home":
		data, err = client.GetHomeFeed(ctx)
	case "explore":
		data, err = client.GetExplore(ctx)
	case "charts":
		data, err = client.GetCharts(ctx)
	case "moods", "genres":
		data, err = client.GetMoodsAndGenres(ctx)
	case "new-releases":
		data, err = client.GetNewReleases(ctx)
	case "history":
		data, err = client.GetHistory(ctx)
	case "sponsorblock":
		if !musicID.MatchString(id) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid ID"})
		}
		data, err = innertube.DefaultSponsorBlock.GetSegments(ctx, id)
	case "search":
		if token != "" {
			data, err = client.ContinueSearch(ctx, token, query)
		} else if query != "" {
			data, err = client.Search(ctx, query, innertube.SearchOptions{})
		} else {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Search query required"})
		}
	case "suggestions":
		if query == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Search query required"})
		}
		data, err = client.GetSearchSuggestions(ctx, query)
	case "continue":
		if token == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Continuation required"})
		}
		data, err = client.ContinueBrowse(ctx, token)
	case "artist", "album", "playlist", "podcast", "queue", "related", "lyrics":
		if !musicID.MatchString(id) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid ID"})
		}
		switch c.Params("kind") {
		case "artist":
			data, err = client.GetArtist(ctx, id)
		case "album":
			data, err = client.GetAlbum(ctx, id)
		case "playlist":
			data, err = client.GetPlaylist(ctx, id)
		case "podcast":
			data, err = client.GetPodcast(ctx, id)
		case "queue":
			data, err = client.GetUpNext(ctx, innertube.UpNextOptions{VideoID: id, Continuation: token})
		case "related":
			data, err = client.GetRelated(ctx, id)
		case "lyrics":
			data, err = client.GetLyrics(ctx, id)
		}
	default:
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Not found"})
	}
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Music data unavailable. Please try again."})
	}
	return c.JSON(fiber.Map{"data": data, "source": "wisewave"})
}
