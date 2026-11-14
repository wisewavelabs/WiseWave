package search

import (
	"time"
	"wisewave-runtime/internal/models"
)

type entry struct {
	tracks  []models.Track
	expires time.Time
}
type flight struct {
	done   chan struct{}
	tracks []models.Track
	err    error
}
