package listening

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const SessionGap = 30 * time.Minute

const schemaVersion = 2

const playColumns = `id, attempt_id, track_id, title, artist, artist_id, album, album_id, artwork_url, started_at_ms, ended_at_ms, listened_ms, track_duration_ms, qualified, completed, session_id`

type Heartbeat struct {
	AttemptID       string `json:"attempt_id"`
	TrackID         string `json:"track_id"`
	Title           string `json:"title"`
	Artist          string `json:"artist"`
	ArtistID        string `json:"artist_id"`
	Album           string `json:"album"`
	AlbumID         string `json:"album_id"`
	ArtworkURL      string `json:"artwork_url"`
	ListenedMs      int64  `json:"listened_ms"`
	TrackDurationMs int64  `json:"track_duration_ms"`
	StartedAtMs     int64  `json:"started_at_ms"`
	Private         bool   `json:"private"`
}

type Play struct {
	ID              int64  `json:"id"`
	AttemptID       string `json:"attempt_id"`
	TrackID         string `json:"track_id"`
	Title           string `json:"title"`
	Artist          string `json:"artist"`
	ArtistID        string `json:"artist_id"`
	Album           string `json:"album"`
	AlbumID         string `json:"album_id"`
	ArtworkURL      string `json:"artwork_url"`
	StartedAtMs     int64  `json:"started_at_ms"`
	EndedAtMs       int64  `json:"ended_at_ms"`
	ListenedMs      int64  `json:"listened_ms"`
	TrackDurationMs int64  `json:"track_duration_ms"`
	Qualified       bool   `json:"qualified"`
	Completed       bool   `json:"completed"`
	SessionID       string `json:"session_id"`
	LocalDate       string `json:"local_date,omitempty"`
}

type Overview struct {
	ListenedMs  int64 `json:"listened_ms"`
	Plays       int64 `json:"plays"`
	Tracks      int64 `json:"tracks"`
	Artists     int64 `json:"artists"`
	Albums      int64 `json:"albums"`
	Completed   int64 `json:"completed"`
	Sessions    int64 `json:"sessions"`
	AvgListenMs int64 `json:"avg_listened_ms"`
}

type DayBucket struct {
	Date       string `json:"date"`
	ListenedMs int64  `json:"listened_ms"`
	Plays      int64  `json:"plays"`
}

type HourBucket struct {
	Hour       int   `json:"hour"`
	ListenedMs int64 `json:"listened_ms"`
	Plays      int64 `json:"plays"`
}

type Activity struct {
	Days  []DayBucket  `json:"days"`
	Hours []HourBucket `json:"hours"`
}

type Heatmap struct {
	Year int         `json:"year"`
	Days []DayBucket `json:"days"`
}

type TopTrack struct {
	TrackID    string `json:"track_id"`
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	ArtistID   string `json:"artist_id"`
	Album      string `json:"album"`
	AlbumID    string `json:"album_id"`
	ArtworkURL string `json:"artwork_url"`
	ListenedMs int64  `json:"listened_ms"`
	Plays      int64  `json:"plays"`
	Completed  int64  `json:"completed"`
}

type TopArtist struct {
	Artist     string `json:"artist"`
	ArtistID   string `json:"artist_id"`
	ArtworkURL string `json:"artwork_url,omitempty"`
	ListenedMs int64  `json:"listened_ms"`
	Plays      int64  `json:"plays"`
	Tracks     int64  `json:"tracks"`
}

type TopAlbum struct {
	Album      string `json:"album"`
	AlbumID    string `json:"album_id"`
	Artist     string `json:"artist"`
	ArtworkURL string `json:"artwork_url,omitempty"`
	ListenedMs int64  `json:"listened_ms"`
	Plays      int64  `json:"plays"`
	Tracks     int64  `json:"tracks"`
}

type HistoryPage struct {
	Items []Play `json:"items"`
	Total int64  `json:"total"`
}

type SessionSummary struct {
	ID          string `json:"id"`
	StartedAtMs int64  `json:"started_at_ms"`
	EndedAtMs   int64  `json:"ended_at_ms"`
	ListenedMs  int64  `json:"listened_ms"`
	Plays       int64  `json:"plays"`
	Tracks      int64  `json:"tracks"`
	LocalDate   string `json:"local_date,omitempty"`
}

type SessionPage struct {
	Items []SessionSummary `json:"items"`
	Total int64            `json:"total"`
}

type SessionDetail struct {
	Session SessionSummary `json:"session"`
	Plays   []Play         `json:"plays"`
}

const (
	InsightOnRepeat       = "on_repeat"
	InsightNightOwl       = "night_owl"
	InsightEarlyBird      = "early_bird"
	InsightDiscoveries    = "discoveries"
	InsightOldFavorite    = "old_favorite"
	InsightStreak         = "streak"
	InsightLongestStreak  = "longest_streak"
	InsightMilestoneTime  = "milestone_time"
	InsightMilestonePlays = "milestone_plays"
)

type Insight struct {
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Detail     string `json:"detail"`
	TrackID    string `json:"track_id,omitempty"`
	TrackTitle string `json:"track_title,omitempty"`
	Artist     string `json:"artist,omitempty"`
	ArtworkURL string `json:"artwork_url,omitempty"`
	Value      int64  `json:"value,omitempty"`
}

type Rewind struct {
	Kind       string      `json:"kind"`
	Year       int         `json:"year"`
	Month      int         `json:"month,omitempty"`
	Label      string      `json:"label"`
	ListenedMs int64       `json:"listened_ms"`
	Plays      int64       `json:"plays"`
	Tracks     int64       `json:"tracks"`
	Artists    int64       `json:"artists"`
	Albums     int64       `json:"albums"`
	Completed  int64       `json:"completed"`
	TopTracks  []TopTrack  `json:"top_tracks"`
	TopArtists []TopArtist `json:"top_artists"`
	TopAlbums  []TopAlbum  `json:"top_albums"`
	BusiestDay *DayBucket  `json:"busiest_day,omitempty"`
	Insights   []Insight   `json:"insights"`
}

type Store struct {
	db      *sql.DB
	mu      sync.Mutex
	openID  int64
	private bool
	now     func() time.Time
}

func Open(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("listening database path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create listening database directory: %w", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open listening database: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := prepareSQLite(db); err != nil {
		db.Close()
		return nil, err
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(`DELETE FROM plays WHERE listened_ms <= 0`); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db, now: time.Now}, nil
}

func prepareSQLite(db *sql.DB) error {
	if _, err := db.Exec(`PRAGMA busy_timeout = 5000`); err != nil {
		return fmt.Errorf("set listening busy timeout: %w", err)
	}
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		return fmt.Errorf("set listening foreign keys: %w", err)
	}
	var mode string
	if err := db.QueryRow(`PRAGMA journal_mode = WAL`).Scan(&mode); err != nil {
		return fmt.Errorf("set listening journal mode: %w", err)
	}
	if _, err := db.Exec(`PRAGMA synchronous = NORMAL`); err != nil {
		return fmt.Errorf("set listening synchronous mode: %w", err)
	}
	return nil
}

func migrate(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY
	)`); err != nil {
		return fmt.Errorf("create schema migrations: %w", err)
	}
	if err := ensureSchemaMigrationsColumns(db); err != nil {
		return err
	}
	var current int
	if err := db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&current); err != nil {
		return err
	}
	for version := current + 1; version <= schemaVersion; version++ {
		if err := applyMigration(db, version); err != nil {
			return err
		}
	}
	return nil
}

func ensureSchemaMigrationsColumns(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(schema_migrations)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	hasApplied := false
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt any
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == "applied_at_ms" {
			hasApplied = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if hasApplied {
		return nil
	}
	_, err = db.Exec(`ALTER TABLE schema_migrations ADD COLUMN applied_at_ms INTEGER NOT NULL DEFAULT 0`)
	return err
}

func applyMigration(db *sql.DB, version int) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	switch version {
	case 1:
		if _, err := tx.Exec(`CREATE TABLE plays (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			track_id TEXT NOT NULL,
			title TEXT NOT NULL DEFAULT '',
			artist TEXT NOT NULL DEFAULT '',
			artist_id TEXT NOT NULL DEFAULT '',
			album TEXT NOT NULL DEFAULT '',
			album_id TEXT NOT NULL DEFAULT '',
			artwork_url TEXT NOT NULL DEFAULT '',
			started_at_ms INTEGER NOT NULL,
			ended_at_ms INTEGER NOT NULL,
			listened_ms INTEGER NOT NULL,
			track_duration_ms INTEGER NOT NULL,
			qualified INTEGER NOT NULL DEFAULT 0,
			completed INTEGER NOT NULL DEFAULT 0,
			session_id TEXT NOT NULL
		)`); err != nil {
			return fmt.Errorf("create plays: %w", err)
		}
		indexes := []string{
			`CREATE INDEX idx_plays_started_at ON plays(started_at_ms)`,
			`CREATE INDEX idx_plays_track_started ON plays(track_id, started_at_ms)`,
			`CREATE INDEX idx_plays_artist_started ON plays(artist_id, started_at_ms)`,
			`CREATE INDEX idx_plays_session ON plays(session_id)`,
			`CREATE INDEX idx_plays_qualified_started ON plays(qualified, started_at_ms)`,
		}
		for _, index := range indexes {
			if _, err := tx.Exec(index); err != nil {
				return fmt.Errorf("create plays index: %w", err)
			}
		}
	case 2:
		if _, err := tx.Exec(`ALTER TABLE plays ADD COLUMN attempt_id TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("add attempt_id: %w", err)
		}
		if _, err := tx.Exec(`UPDATE plays SET attempt_id = printf('legacy-%d', id) WHERE attempt_id = ''`); err != nil {
			return fmt.Errorf("backfill attempt_id: %w", err)
		}
		if _, err := tx.Exec(`CREATE UNIQUE INDEX idx_plays_attempt ON plays(attempt_id)`); err != nil {
			return fmt.Errorf("create attempt index: %w", err)
		}
	default:
		return fmt.Errorf("unknown listening schema version %d", version)
	}
	if _, err := tx.Exec(`INSERT INTO schema_migrations (version, applied_at_ms) VALUES (?, ?)`, version, time.Now().UnixMilli()); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	s.openID = 0
	return err
}

func (s *Store) SetPrivate(on bool) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.private = on
	s.mu.Unlock()
}

func (s *Store) Heartbeat(h Heartbeat) error {
	if h.Private {
		return nil
	}
	if s == nil {
		return errors.New("listening store is closed")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return errors.New("listening store is closed")
	}
	if s.private {
		return nil
	}
	return s.heartbeatLocked(h)
}

func (s *Store) Finalize() error {
	if s == nil {
		return errors.New("listening store is closed")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return errors.New("listening store is closed")
	}
	return s.finalizeLocked()
}

func (s *Store) Discard() error {
	if s == nil {
		return errors.New("listening store is closed")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return errors.New("listening store is closed")
	}
	return s.discardLocked()
}

func (s *Store) Clear() error {
	if s == nil {
		return errors.New("listening store is closed")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return errors.New("listening store is closed")
	}
	s.openID = 0
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM plays`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM sqlite_sequence WHERE name = 'plays'`); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) heartbeatLocked(h Heartbeat) error {
	h.TrackID = strings.TrimSpace(h.TrackID)
	if h.TrackID == "" {
		return nil
	}
	h.AttemptID = strings.TrimSpace(h.AttemptID)
	h.ListenedMs = capListened(h.ListenedMs, h.TrackDurationMs)
	nowMs := s.clock().UnixMilli()
	if h.AttemptID != "" {
		current, err := s.playByAttempt(h.AttemptID, nil)
		if err != nil {
			return err
		}
		if current != nil {
			if s.openID != 0 && s.openID != current.ID {
				if err := s.finalizeLocked(); err != nil {
					return err
				}
			}
			s.openID = current.ID
			return s.updateOpen(*current, h, nowMs)
		}
	}
	if s.openID != 0 {
		current, err := s.playByID(s.openID, nil)
		if err != nil {
			return err
		}
		if current != nil && sameAttempt(*current, h) {
			if h.AttemptID != "" && current.AttemptID == "" {
				if _, err := s.db.Exec(`UPDATE plays SET attempt_id = ? WHERE id = ?`, h.AttemptID, current.ID); err != nil {
					return err
				}
				current.AttemptID = h.AttemptID
			}
			return s.updateOpen(*current, h, nowMs)
		}
		if err := s.finalizeLocked(); err != nil {
			return err
		}
	}
	return s.insertOpen(h, nowMs)
}

func (s *Store) updateOpen(current Play, h Heartbeat, nowMs int64) error {
	listened := capListened(h.ListenedMs, positive(h.TrackDurationMs, current.TrackDurationMs))
	if listened < current.ListenedMs {
		listened = current.ListenedMs
	}
	duration := positive(h.TrackDurationMs, current.TrackDurationMs)
	listened = capListened(listened, duration)
	ended := nowMs
	if ended < current.StartedAtMs {
		ended = current.StartedAtMs
	}
	qualified, completed := storedFlags(listened, duration)
	_, err := s.db.Exec(`UPDATE plays SET
		title = ?, artist = ?, artist_id = ?, album = ?, album_id = ?, artwork_url = ?,
		ended_at_ms = ?, listened_ms = ?, track_duration_ms = ?, qualified = ?, completed = ?
		WHERE id = ?`,
		firstNonEmpty(h.Title, current.Title),
		firstNonEmpty(h.Artist, current.Artist),
		firstNonEmpty(h.ArtistID, current.ArtistID),
		firstNonEmpty(h.Album, current.Album),
		firstNonEmpty(h.AlbumID, current.AlbumID),
		firstNonEmpty(h.ArtworkURL, current.ArtworkURL),
		ended, listened, duration, flagInt(qualified), flagInt(completed), current.ID,
	)
	return err
}

func (s *Store) insertOpen(h Heartbeat, nowMs int64) error {
	started := h.StartedAtMs
	if started <= 0 || started > nowMs+2*60*1000 {
		started = nowMs
	}
	ended := nowMs
	if ended < started {
		ended = started
	}
	attemptID := h.AttemptID
	if attemptID == "" {
		attemptID = newAttemptID()
	}
	sessionID, err := s.sessionIDFor(started)
	if err != nil {
		return err
	}
	qualified, completed := storedFlags(h.ListenedMs, h.TrackDurationMs)
	res, err := s.db.Exec(`INSERT INTO plays (
		attempt_id, track_id, title, artist, artist_id, album, album_id, artwork_url,
		started_at_ms, ended_at_ms, listened_ms, track_duration_ms, qualified, completed, session_id
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		attemptID,
		h.TrackID,
		strings.TrimSpace(h.Title),
		strings.TrimSpace(h.Artist),
		strings.TrimSpace(h.ArtistID),
		strings.TrimSpace(h.Album),
		strings.TrimSpace(h.AlbumID),
		strings.TrimSpace(h.ArtworkURL),
		started, ended, h.ListenedMs, max64(h.TrackDurationMs, 0),
		flagInt(qualified), flagInt(completed), sessionID,
	)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	s.openID = id
	return nil
}

func (s *Store) finalizeLocked() error {
	if s.openID == 0 {
		return nil
	}
	id := s.openID
	s.openID = 0
	var listened, duration, started, ended int64
	err := s.db.QueryRow(`SELECT listened_ms, track_duration_ms, started_at_ms, ended_at_ms FROM plays WHERE id = ?`, id).Scan(&listened, &duration, &started, &ended)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if listened <= 0 {
		_, err = s.db.Exec(`DELETE FROM plays WHERE id = ?`, id)
		return err
	}
	nowMs := s.clock().UnixMilli()
	if ended < nowMs {
		ended = nowMs
	}
	if ended < started {
		ended = started
	}
	qualified, completed := storedFlags(listened, duration)
	_, err = s.db.Exec(`UPDATE plays SET ended_at_ms = ?, qualified = ?, completed = ? WHERE id = ?`, ended, flagInt(qualified), flagInt(completed), id)
	return err
}

func (s *Store) discardLocked() error {
	if s.openID == 0 {
		return nil
	}
	id := s.openID
	s.openID = 0
	_, err := s.db.Exec(`DELETE FROM plays WHERE id = ?`, id)
	return err
}

func (s *Store) sessionIDFor(startedMs int64) (string, error) {
	var sessionID string
	var ended int64
	err := s.db.QueryRow(`SELECT session_id, ended_at_ms FROM plays ORDER BY ended_at_ms DESC, id DESC LIMIT 1`).Scan(&sessionID, &ended)
	if errors.Is(err, sql.ErrNoRows) || sessionID == "" {
		return newSessionID(), nil
	}
	if err != nil {
		return "", err
	}
	if startedMs-ended > sessionGapMs() {
		return newSessionID(), nil
	}
	return sessionID, nil
}

func sessionGapMs() int64 {
	return int64(SessionGap / time.Millisecond)
}

func (s *Store) clock() time.Time {
	if s.now == nil {
		return time.Now()
	}
	return s.now()
}

func (s *Store) window(name, timezone string) (Window, error) {
	return ResolveRange(name, timezone, s.clock())
}

func sameAttempt(current Play, h Heartbeat) bool {
	if h.AttemptID != "" && current.AttemptID != "" {
		return current.AttemptID == h.AttemptID
	}
	if current.TrackID != h.TrackID {
		return false
	}
	if h.StartedAtMs <= 0 {
		return true
	}
	delta := h.StartedAtMs - current.StartedAtMs
	if delta < 0 {
		delta = -delta
	}
	return delta <= 2000
}

func newSessionID() string {
	return newAttemptID()
}

func newAttemptID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(buf[:])
}

func capListened(listened, duration int64) int64 {
	if listened < 0 {
		listened = 0
	}
	if duration > 0 && listened > duration {
		return duration
	}
	return listened
}

func positive(primary, fallback int64) int64 {
	if primary > 0 {
		return primary
	}
	if fallback > 0 {
		return fallback
	}
	return 0
}

func max64(value, floor int64) int64 {
	if value < floor {
		return floor
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanPlay(row rowScanner, loc *time.Location) (Play, error) {
	var play Play
	var qualified, completed int
	err := row.Scan(
		&play.ID, &play.AttemptID, &play.TrackID, &play.Title, &play.Artist, &play.ArtistID, &play.Album, &play.AlbumID, &play.ArtworkURL,
		&play.StartedAtMs, &play.EndedAtMs, &play.ListenedMs, &play.TrackDurationMs, &qualified, &completed, &play.SessionID,
	)
	if err != nil {
		return Play{}, err
	}
	play.Qualified = qualified != 0
	play.Completed = completed != 0
	if loc != nil {
		play.LocalDate = LocalDay(play.StartedAtMs, loc)
	}
	return play, nil
}

func (s *Store) playByID(id int64, loc *time.Location) (*Play, error) {
	row := s.db.QueryRow(`SELECT `+playColumns+` FROM plays WHERE id = ?`, id)
	play, err := scanPlay(row, loc)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &play, nil
}

func (s *Store) playByAttempt(attemptID string, loc *time.Location) (*Play, error) {
	attemptID = strings.TrimSpace(attemptID)
	if attemptID == "" {
		return nil, nil
	}
	row := s.db.QueryRow(`SELECT `+playColumns+` FROM plays WHERE attempt_id = ?`, attemptID)
	play, err := scanPlay(row, loc)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &play, nil
}
