package handlers

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"wisewave-runtime/internal/downloader"
	"wisewave-runtime/internal/err"
)

type DownloadHandler struct {
	service *downloader.Service
}

func NewDownloadHandler(service *downloader.Service) *DownloadHandler {
	return &DownloadHandler{service: service}
}

type downloadRequest struct {
	TrackID  string `json:"track_id"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Album    string `json:"album"`
	Duration int    `json:"duration"`
}

func (h *DownloadHandler) HandleDownload(c *fiber.Ctx) error {
	var req downloadRequest
	if failure := c.BodyParser(&req); failure != nil || req.TrackID == "" {
		req.TrackID = c.Query("track_id")
		if req.TrackID == "" {
			req.TrackID = c.Query("id")
		}
		req.Title = c.Query("title")
		req.Artist = c.Query("artist")
		req.Album = c.Query("album")
		if durStr := c.Query("duration"); durStr != "" {
			req.Duration, _ = strconv.Atoi(durStr)
		}
	}

	if strings.TrimSpace(req.TrackID) == "" {
		return err.Respond(c, fmt.Errorf("track_id is required to download"), fiber.StatusBadRequest)
	}

	result, failure := h.service.DownloadTrack(req.TrackID, req.Title, req.Artist, req.Album, req.Duration)
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusBadGateway)
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    result,
		"source":  "wisewave",
	})
}

func (h *DownloadHandler) HandleListOffline(c *fiber.Ctx) error {
	tracks, failure := h.service.ListOfflineTracks()
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusInternalServerError)
	}

	return c.JSON(fiber.Map{
		"data":   tracks,
		"total":  len(tracks),
		"source": "wisewave",
	})
}

func (h *DownloadHandler) HandleDownloadAudio(c *fiber.Ctx) error {
	trackID := c.Params("id")
	if strings.TrimSpace(trackID) == "" {
		return err.Respond(c, fmt.Errorf("track id required"), fiber.StatusBadRequest)
	}

	filePath, fileName, failure := h.service.GetOfflineAudioFile(trackID)
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusNotFound)
	}

	safeName := strings.ReplaceAll(fileName, "\"", "_")
	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", safeName))
	return c.SendFile(filePath)
}

func (h *DownloadHandler) HandleDownloadLyrics(c *fiber.Ctx) error {
	trackID := c.Params("id")
	if strings.TrimSpace(trackID) == "" {
		return err.Respond(c, fmt.Errorf("track id required"), fiber.StatusBadRequest)
	}

	lyricsPath, fileName, failure := h.service.GetOfflineLyricsFile(trackID)
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusNotFound)
	}

	safeName := strings.ReplaceAll(fileName, "\"", "_")
	c.Set("Content-Type", "text/plain; charset=utf-8")
	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", safeName))
	return c.SendFile(lyricsPath)
}

func (h *DownloadHandler) HandleDownloadBundle(c *fiber.Ctx) error {
	trackID := c.Params("id")
	if strings.TrimSpace(trackID) == "" {
		return err.Respond(c, fmt.Errorf("track id required"), fiber.StatusBadRequest)
	}

	if _, _, failure := h.service.GetOfflineAudioFile(trackID); failure != nil {
		return err.Respond(c, failure, fiber.StatusNotFound)
	}

	safeID := strings.ReplaceAll(trackID, "\"", "_")
	c.Set("Content-Type", "application/zip")
	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.zip\"", safeID))

	_, failure := h.service.StreamZipBundle(trackID, c.Response().BodyWriter())
	if failure != nil {
		return err.Respond(c, failure, fiber.StatusInternalServerError)
	}

	return nil
}
