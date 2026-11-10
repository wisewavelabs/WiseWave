package handlers

import (
	"github.com/gofiber/fiber/v2"
	"strings"
	"wisewave-runtime/internal/innertube"
)

func (h *TrackHandler) CatalogArtist(c *fiber.Ctx) error {
	id := c.Params("id")
	if !innertube.ValidCatalogID(id, true) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid artist"})
	}
	detail, err := h.tube.Artist(id)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Artist unavailable. Please try again."})
	}
	return c.JSON(fiber.Map{"data": detail, "source": "wisewave"})
}

func (h *TrackHandler) CatalogAlbum(c *fiber.Ctx) error {
	id := c.Params("id")
	if !innertube.ValidCatalogID(id, false) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid album"})
	}
	detail, err := h.tube.Album(id)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Album unavailable. Please try again."})
	}
	return c.JSON(fiber.Map{"data": detail, "source": "wisewave"})
}

func (h *TrackHandler) CatalogSearch(c *fiber.Ctx) error {
	query := strings.TrimSpace(c.Query("q"))
	kind := c.Query("type")
	if query == "" || len(query) > 512 || (kind != "artists" && kind != "albums") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search"})
	}
	items, err := h.tube.SearchCatalog(query, kind == "artists")
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Search unavailable. Please try again."})
	}
	return c.JSON(fiber.Map{"data": items, "source": "wisewave"})
}

func (h *TrackHandler) CatalogNewReleases(c *fiber.Ctx) error {
	albums, err := h.tube.NewReleases()
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "New releases are unavailable. Please try again."})
	}
	return c.JSON(fiber.Map{"data": albums, "source": "wisewave"})
}

func (h *TrackHandler) Popular(c *fiber.Ctx) error {
	tracks, err := h.tube.Popular()
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Popular music is unavailable. Please try again.", "source": "wisewave"})
	}
	return c.JSON(fiber.Map{"data": tracks, "source": "wisewave"})
}
