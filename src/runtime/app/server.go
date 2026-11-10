package app

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"wisewave-runtime/internal/cache"
	"wisewave-runtime/internal/config"
	"wisewave-runtime/internal/downloader"
	"wisewave-runtime/internal/err"
	"wisewave-runtime/internal/external/gaana"
	"wisewave-runtime/internal/external/jiosaavn"
	"wisewave-runtime/internal/external/spotify"
	"wisewave-runtime/internal/handlers"
	"wisewave-runtime/internal/innertube"
	"wisewave-runtime/internal/lyrics"
	"wisewave-runtime/internal/storage"
)

func Run() error {
	config.ConfigureDNS()
	cfg := config.Load()

	app := fiber.New(fiber.Config{
		AppName:      "WiseWave Native Runtime (Go Fiber)",
		ServerHeader: "WiseWave",
		ErrorHandler: err.FiberErrorHandler,
	})

	app.Use(recover.New())
	app.Use(logger.New(logger.Config{
		Format: "[${time}] ${status} - ${latency} ${method} ${path}\n",
	}))

	app.Use(func(c *fiber.Ctx) error {
		if site := c.Get("Sec-Fetch-Site"); site == "cross-site" {
			return c.Status(fiber.StatusForbidden).SendString("Forbidden cross-site request")
		}
		return c.Next()
	})

	app.Use(cors.New(cors.Config{
		AllowOriginsFunc: allowedOrigin,
		AllowHeaders:     "Origin, Content-Type, Accept, Range, Authorization",
		AllowMethods:     "GET, POST, HEAD, OPTIONS",
	}))

	baseURL := fmt.Sprintf("http://127.0.0.1:%s", cfg.Port)
	catalog := storage.NewCatalog(cfg.MediaDir, baseURL)
	streamCache := cache.NewStreamCache()
	tubeClient := innertube.NewClient()
	saavnClient := jiosaavn.NewClient()
	gaanaClient := gaana.NewClient()
	spotifyClient := spotify.NewClient()
	lyricsService := lyrics.NewService(tubeClient.MusicClient)
	downloadService := downloader.NewService(catalog, cfg.MediaDir, tubeClient, saavnClient, gaanaClient, lyricsService, streamCache)

	streamHandler := handlers.NewStreamHandler(catalog, cfg.MediaDir, tubeClient, streamCache, saavnClient, gaanaClient)
	trackHandler := handlers.NewTrackHandler(catalog, tubeClient, saavnClient, gaanaClient, spotifyClient)
	lyricsHandler := handlers.NewLyricsHandler(lyricsService)
	downloadHandler := handlers.NewDownloadHandler(downloadService)

	api := app.Group("/api/v1")
	{
		api.Get("/health", func(c *fiber.Ctx) error {
			return c.JSON(fiber.Map{
				"app":            "wisewave",
				"status":         "online",
				"tracks_indexed": len(catalog.GetAllTracks()),
				"media_dir":      cfg.MediaDir,
			})
		})

		api.Get("/tracks", trackHandler.GetTracks)
		api.Get("/tracks/:id", trackHandler.GetTrack)
		api.Get("/search", trackHandler.Search)
		api.Get("/popular", trackHandler.Popular)
		api.Get("/radio", trackHandler.Radio)
		api.Post("/discover", trackHandler.Discover)
		api.Get("/albums", trackHandler.GetAlbums)
		api.Get("/catalog/artists/:id", trackHandler.CatalogArtist)
		api.Get("/catalog/albums/:id", trackHandler.CatalogAlbum)
		api.Get("/catalog/search", trackHandler.CatalogSearch)
		api.Get("/catalog/new-releases", trackHandler.CatalogNewReleases)
		api.Get("/music/:kind/:id?", trackHandler.Music)

		api.Get("/saavn/search", trackHandler.SearchSaavn)
		api.Get("/gaana/search", trackHandler.SearchGaana)
		api.Get("/spotify/search", trackHandler.SearchSpotifyPlaylists)
		api.Get("/spotify/tracks/:id", trackHandler.GetSpotifyTrack)
		api.Get("/spotify/playlists/:id", trackHandler.GetSpotifyPlaylist)
		api.Get("/spotify/playlists", trackHandler.GetSpotifyPlaylist)

		api.Post("/download", downloadHandler.HandleDownload)
		api.Get("/offline/tracks", downloadHandler.HandleListOffline)
		api.Get("/download/:id/audio", downloadHandler.HandleDownloadAudio)
		api.Get("/download/:id/lyrics", downloadHandler.HandleDownloadLyrics)
		api.Get("/download/:id/bundle", downloadHandler.HandleDownloadBundle)

		api.Post("/rescan", func(c *fiber.Ctx) error {
			count := catalog.Rescan()
			return c.JSON(fiber.Map{
				"message":        "Library rescan complete",
				"indexed_tracks": count,
			})
		})

		api.Get("/stream/:id", streamHandler.HandleStream)
		api.Get("/resolve/:id", streamHandler.HandleResolve)
		api.Get("/artwork/:id", streamHandler.HandleArtwork)

		api.Get("/lyrics", lyricsHandler.HandleLyrics)
	}

	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
		<-sigChan
		log.Println("Shutting down WiseWave runtime...")
		_ = app.Shutdown()
	}()

	addr := fmt.Sprintf("127.0.0.1:%s", cfg.Port)
	log.Printf("WiseWave Runtime starting on http://127.0.0.1:%s\n", cfg.Port)
	log.Printf("Audio media directory: %s\n", cfg.MediaDir)
	return app.Listen(addr)
}

func allowedOrigin(origin string) bool {
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Opaque != "" || parsed.User != nil || parsed.Path != "" || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || strings.ContainsAny(origin, "?#") {
		return false
	}
	host := parsed.Hostname()
	if host != "localhost" && host != "127.0.0.1" {
		return false
	}
	if parsed.Host == host {
		return true
	}
	if !strings.HasPrefix(parsed.Host, host+":") {
		return false
	}
	port := parsed.Port()
	if port == "" {
		return false
	}
	value, err := strconv.ParseUint(port, 10, 16)
	return err == nil && value > 0
}
