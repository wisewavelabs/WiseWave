package handlers

import (
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"wisewave-runtime/internal/err"
	"wisewave-runtime/internal/external/gaana"
	"wisewave-runtime/internal/external/jiosaavn"
	"wisewave-runtime/internal/external/spotify"
	"wisewave-runtime/internal/innertube"
	"wisewave-runtime/internal/models"
	"wisewave-runtime/internal/storage"
)

type TrackHandler struct {
	catalog *storage.Catalog
	tube    *innertube.Client
	saavn   *jiosaavn.Client
	gaana   *gaana.Client
	spotify *spotify.Client
}

func (h *TrackHandler) Radio(c *fiber.Ctx) error {
	id := strings.TrimSpace(c.Query("id"))
	if id == "" {
		return err.Respond(c, fmt.Errorf("track required"), fiber.StatusBadRequest)
	}
	tracks, failure := h.tube.Related(id)
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusBadGateway)
	}
	return c.JSON(fiber.Map{"data": tracks, "source": "wisewave"})
}

func NewTrackHandler(
	catalog *storage.Catalog,
	tube *innertube.Client,
	saavn *jiosaavn.Client,
	gaana *gaana.Client,
	spotify *spotify.Client,
) *TrackHandler {
	return &TrackHandler{
		catalog: catalog,
		tube:    tube,
		saavn:   saavn,
		gaana:   gaana,
		spotify: spotify,
	}
}

func (h *TrackHandler) GetTracks(c *fiber.Ctx) error {
	tracks := h.catalog.GetAllTracks()
	return c.JSON(fiber.Map{
		"data":  tracks,
		"total": len(tracks),
	})
}

func (h *TrackHandler) GetTrack(c *fiber.Ctx) error {
	id := c.Params("id")
	track, exists := h.catalog.GetTrack(id)
	if !exists {
		return err.Respond(c, fmt.Errorf("track not found in local library"), fiber.StatusNotFound)
	}
	return c.JSON(fiber.Map{
		"data": track,
	})
}

func (h *TrackHandler) Search(c *fiber.Ctx) error {
	query := c.Query("q")
	if query == "" {
		return c.JSON(fiber.Map{
			"data":  []interface{}{},
			"total": 0,
		})
	}

	source := c.Query("source")
	if source == "saavn" || source == "jiosaavn" {
		saavnResults, failure := h.saavn.Search(query)
		if failure != nil {
			return err.Respond(c, failure, fiber.StatusInternalServerError)
		}
		return c.JSON(fiber.Map{
			"data":   saavnResults,
			"total":  len(saavnResults),
			"query":  query,
			"source": "wisewave",
		})
	}

	if source == "gaana" {
		gaanaResults, failure := h.gaana.Search(query)
		if failure != nil {
			return err.Respond(c, failure, fiber.StatusInternalServerError)
		}
		return c.JSON(fiber.Map{
			"data":   gaanaResults,
			"total":  len(gaanaResults),
			"query":  query,
			"source": "wisewave",
		})
	}

	if source == "spotify" || source == "spotify_playlist" {
		return h.SearchSpotifyPlaylists(c)
	}

	localResults := h.catalog.Search(query)
	combined := make([]models.Track, 0)
	combined = append(combined, localResults...)

	remoteResults, failure := h.tube.Search(query)
	if failure != nil {
		log.Printf("tube search error for %s: %v", query, failure)
	}
	if failure == nil && len(remoteResults) > 0 {
		combined = append(combined, remoteResults...)
	} else {
		saavnResults, errSaavn := h.saavn.Search(query)
		if errSaavn == nil && len(saavnResults) > 0 {
			combined = append(combined, saavnResults...)
		}
		gaanaResults, errGaana := h.gaana.Search(query)
		if errGaana == nil && len(gaanaResults) > 0 {
			combined = append(combined, gaanaResults...)
		}
	}

	return c.JSON(fiber.Map{
		"data":   combined,
		"total":  len(combined),
		"query":  query,
		"source": "wisewave",
	})
}

func (h *TrackHandler) SearchSaavn(c *fiber.Ctx) error {
	query := c.Query("q")
	if query == "" {
		return c.JSON(fiber.Map{"data": []models.Track{}, "total": 0})
	}
	results, failure := h.saavn.Search(query)
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{
		"data":   results,
		"total":  len(results),
		"query":  query,
		"source": "wisewave",
	})
}

func (h *TrackHandler) SearchGaana(c *fiber.Ctx) error {
	query := c.Query("q")
	if query == "" {
		return c.JSON(fiber.Map{"data": []models.Track{}, "total": 0})
	}
	results, failure := h.gaana.Search(query)
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{
		"data":   results,
		"total":  len(results),
		"query":  query,
		"source": "wisewave",
	})
}

func (h *TrackHandler) GetAlbums(c *fiber.Ctx) error {
	albums := h.catalog.GetAllAlbums()
	return c.JSON(fiber.Map{
		"data":  albums,
		"total": len(albums),
	})
}

func (h *TrackHandler) SearchSpotifyPlaylists(c *fiber.Ctx) error {
	query := c.Query("q")
	if query == "" {
		return c.JSON(fiber.Map{"data": []models.Playlist{}, "total": 0})
	}

	offset := 0
	if offsetStr := c.Query("offset"); offsetStr != "" {
		if parsed, failure := strconv.Atoi(offsetStr); failure == nil && parsed >= 0 {
			offset = parsed
		}
	} else if cont := c.Query("continuation"); strings.HasPrefix(cont, "sp-search:") {
		if parsed, failure := strconv.Atoi(strings.TrimPrefix(cont, "sp-search:")); failure == nil && parsed >= 0 {
			offset = parsed
		}
	}

	playlists, continuation, failure := h.spotify.SearchPlaylists(query, offset)
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusInternalServerError)
	}

	resp := fiber.Map{
		"data":   playlists,
		"total":  len(playlists),
		"query":  query,
		"source": "wisewave",
	}
	if continuation != "" {
		resp["continuation"] = continuation
	}
	return c.JSON(resp)
}

func (h *TrackHandler) GetSpotifyPlaylist(c *fiber.Ctx) error {
	target := c.Params("id")
	if target == "" {
		target = c.Query("url")
	}
	if target == "" {
		target = c.Query("id")
	}
	if target == "" {
		return err.Respond(c, fmt.Errorf("playlist identifier or url is required"), fiber.StatusBadRequest)
	}

	offset := 0
	if offsetStr := c.Query("offset"); offsetStr != "" {
		if parsed, failure := strconv.Atoi(offsetStr); failure == nil && parsed >= 0 {
			offset = parsed
		}
	} else if cont := c.Query("continuation"); strings.HasPrefix(cont, "sp-playlist:") {
		parts := strings.Split(cont, ":")
		if len(parts) == 3 {
			if parsed, failure := strconv.Atoi(parts[2]); failure == nil && parsed >= 0 {
				offset = parsed
			}
		}
	}

	detail, failure := h.spotify.GetPlaylist(target, offset)
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusNotFound)
	}

	return c.JSON(fiber.Map{
		"data": detail,
	})
}

func (h *TrackHandler) GetSpotifyTrack(c *fiber.Ctx) error {
	id := c.Params("id")
	if len(id) != 22 || strings.Trim(id, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") != "" {
		return err.Respond(c, fmt.Errorf("invalid track"), fiber.StatusBadRequest)
	}
	track, failure := h.spotify.GetTrack(id)
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusNotFound)
	}
	return c.JSON(fiber.Map{"data": track, "source": "wisewave"})
}
