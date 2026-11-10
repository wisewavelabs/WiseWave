package handlers

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"wisewave-runtime/internal/err"
	"wisewave-runtime/internal/lyrics"
)

type LyricsHandler struct {
	service *lyrics.Service
}

func NewLyricsHandler(service *lyrics.Service) *LyricsHandler {
	return &LyricsHandler{service: service}
}

func (h *LyricsHandler) HandleLyrics(c *fiber.Ctx) error {
	title := strings.TrimSpace(c.Query("title"))
	artist := strings.TrimSpace(c.Query("artist"))
	album := c.Query("album")
	durationStr := c.Query("duration")

	if title == "" || artist == "" || len(title) > 1024 || len(artist) > 1024 || len(album) > 1024 {
		return err.Respond(c, fmt.Errorf("title and artist are required"), fiber.StatusBadRequest)
	}

	var durationSec int
	if durationStr != "" {
		var failure error
		durationSec, failure = strconv.Atoi(durationStr)
		if failure != nil || durationSec < 0 || durationSec > 86400 {
			return err.Respond(c, fmt.Errorf("invalid duration"), fiber.StatusBadRequest)
		}
	}

	videoID := c.Query("video_id")
	if len(videoID) > 160 {
		return err.Respond(c, fmt.Errorf("invalid track"), fiber.StatusBadRequest)
	}
	record, failure := h.service.FetchLyricsForTrack(lyrics.TrackMeta{Title: title, Artist: artist, Album: album, DurationSeconds: durationSec, VideoID: videoID}, c.Query("refresh") == "true" || c.Query("refresh") == "1")
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusNotFound)
	}

	resp := fiber.Map{
		"refining":      record.Refining,
		"source":        "wisewave",
		"type":          record.Type,
		"track_name":    record.TrackName,
		"artist_name":   record.ArtistName,
		"album_name":    record.AlbumName,
		"duration":      record.Duration,
		"instrumental":  record.Instrumental,
		"plain_lyrics":  record.PlainLyrics,
		"synced_lyrics": record.SyncedLyrics,
	}

	if len(record.Lines) > 0 {
		resp["lines"] = record.Lines
	}

	return c.JSON(resp)
}
