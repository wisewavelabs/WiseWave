package models

type Track struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	Artist          string `json:"artist"`
	ArtistID        string `json:"artist_id"`
	Album           string `json:"album"`
	AlbumID         string `json:"album_id"`
	Duration        string `json:"duration"`
	DurationSeconds int    `json:"duration_seconds"`
	AlbumArtURL     string `json:"album_art_url"`
	StreamURL       string `json:"stream_url"`
	FilePath        string `json:"-"`
	IsFavorite      bool   `json:"is_favorite"`
}

type Album struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	CoverURL   string `json:"cover_url"`
	Year       int    `json:"year"`
	TrackCount int    `json:"track_count"`
	Genre      string `json:"genre"`
}

type PlaybackEvent struct {
	Type        string  `json:"type"`
	TrackID     string  `json:"track_id"`
	PositionSec float64 `json:"position_sec"`
	IsPlaying   bool    `json:"is_playing"`
	SenderID    string  `json:"sender_id"`
}

type Playlist struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Author       string `json:"author"`
	ArtworkURL   string `json:"artwork_url"`
	Description  string `json:"description"`
	TrackCount   int    `json:"track_count,omitempty"`
	Continuation string `json:"continuation,omitempty"`
}

type PlaylistDetail struct {
	Playlist     Playlist `json:"playlist"`
	Tracks       []Track  `json:"tracks"`
	Continuation string   `json:"continuation,omitempty"`
}
