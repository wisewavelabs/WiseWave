package config

import (
	"os"
)

type Config struct {
	Port        string
	MediaDir    string
	Environment string
}

func Load() *Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mediaDir := os.Getenv("MEDIA_DIR")
	if mediaDir == "" {
		mediaDir = "./media"
	}

	env := os.Getenv("ENV")
	if env == "" {
		env = "development"
	}

	return &Config{
		Port:        port,
		MediaDir:    mediaDir,
		Environment: env,
	}
}
