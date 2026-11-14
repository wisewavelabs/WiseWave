package listening

import (
	"context"
	"errors"
	"strings"
	"time"
)

func (s *Store) Overview(rangeName, timezone string) (Overview, error) {
	if err := s.lock(); err != nil {
		return Overview{}, err
	}
	defer s.mu.Unlock()
	w, err := s.window(rangeName, timezone)
	if err != nil {
		return Overview{}, err
	}
	return s.overview(w)
}

func (s *Store) Activity(rangeName, timezone string) (Activity, error) {
	if err := s.lock(); err != nil {
		return Activity{}, err
	}
	defer s.mu.Unlock()
	w, err := s.window(rangeName, timezone)
	if err != nil {
		return Activity{}, err
	}
	samples, err := s.loadSamples(w)
	if err != nil {
		return Activity{}, err
	}
	return s.activity(w, samples), nil
}

func (s *Store) Heatmap(year int, timezone string) (Heatmap, error) {
	if err := s.lock(); err != nil {
		return Heatmap{}, err
	}
	defer s.mu.Unlock()
	w, err := YearWindow(year, timezone, s.clock())
	if err != nil {
		return Heatmap{}, err
	}
	samples, err := s.loadSamples(w)
	if err != nil {
		return Heatmap{}, err
	}
	act := s.activity(w, samples)
	resolved := time.UnixMilli(w.FromMs).In(w.location()).Year()
	if act.Days == nil {
		act.Days = []DayBucket{}
	}
	return Heatmap{Year: resolved, Days: act.Days}, nil
}

func (s *Store) TopTracks(rangeName, timezone string, limit, offset int) ([]TopTrack, error) {
	if err := s.lock(); err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	w, err := s.window(rangeName, timezone)
	if err != nil {
		return nil, err
	}
	return s.topTracks(w, limit, offset)
}

func (s *Store) TopArtists(rangeName, timezone string, limit, offset int) ([]TopArtist, error) {
	if err := s.lock(); err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	w, err := s.window(rangeName, timezone)
	if err != nil {
		return nil, err
	}
	return s.topArtists(w, limit, offset)
}

func (s *Store) TopAlbums(rangeName, timezone string, limit, offset int) ([]TopAlbum, error) {
	if err := s.lock(); err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	w, err := s.window(rangeName, timezone)
	if err != nil {
		return nil, err
	}
	return s.topAlbums(w, limit, offset)
}

func (s *Store) History(query string, fromMs, toMs int64, timezone string, limit, offset int) (HistoryPage, error) {
	if err := s.lock(); err != nil {
		return HistoryPage{}, err
	}
	defer s.mu.Unlock()
	return s.history(query, fromMs, toMs, timezone, limit, offset)
}

func (s *Store) Sessions(rangeName, timezone string, limit, offset int) (SessionPage, error) {
	if err := s.lock(); err != nil {
		return SessionPage{}, err
	}
	defer s.mu.Unlock()
	w, err := s.window(rangeName, timezone)
	if err != nil {
		return SessionPage{}, err
	}
	return s.sessions(w, limit, offset)
}

func (s *Store) Session(id string) (SessionDetail, error) {
	if err := s.lock(); err != nil {
		return SessionDetail{}, err
	}
	defer s.mu.Unlock()
	return s.session(strings.TrimSpace(id))
}

func (s *Store) lock() error {
	if s == nil {
		return errors.New("listening store is closed")
	}
	s.mu.Lock()
	if s.db == nil {
		s.mu.Unlock()
		return errors.New("listening store is closed")
	}
	return nil
}

func (s *Store) overview(w Window) (Overview, error) {
	clause, args := w.andStarted()
	var out Overview
	var rows int64
	err := s.db.QueryRow(`SELECT
		COALESCE(SUM(listened_ms), 0),
		COALESCE(SUM(qualified), 0),
		COALESCE(SUM(completed), 0),
		COUNT(DISTINCT track_id),
		COUNT(DISTINCT CASE WHEN artist_id != '' THEN artist_id WHEN artist != '' THEN lower(artist) END),
		COUNT(DISTINCT CASE WHEN album_id != '' THEN album_id WHEN album != '' THEN lower(album) || char(31) || lower(artist) END),
		COUNT(DISTINCT session_id),
		COUNT(*)
		FROM plays WHERE listened_ms > 0`+clause, args...).Scan(
		&out.ListenedMs, &out.Plays, &out.Completed, &out.Tracks, &out.Artists, &out.Albums, &out.Sessions, &rows,
	)
	if err != nil {
		return Overview{}, err
	}
	if rows > 0 {
		out.AvgListenMs = out.ListenedMs / rows
	}
	return out, nil
}

type sample struct {
	started   int64
	listened  int64
	qualified bool
}

func (s *Store) loadSamples(w Window) ([]sample, error) {
	clause, args := w.andStarted()
	rows, err := s.db.Query(`SELECT started_at_ms, listened_ms, qualified FROM plays WHERE listened_ms > 0`+clause, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	samples := make([]sample, 0)
	for rows.Next() {
		var item sample
		var qualified int
		if err := rows.Scan(&item.started, &item.listened, &qualified); err != nil {
			return nil, err
		}
		item.qualified = qualified != 0
		samples = append(samples, item)
	}
	return samples, rows.Err()
}

func (s *Store) activity(w Window, samples []sample) Activity {
	loc := w.location()
	hours := make([]HourBucket, 24)
	for i := range hours {
		hours[i].Hour = i
	}
	byDay := map[string]*DayBucket{}
	var first, last int64
	for _, item := range samples {
		hour := LocalHour(item.started, loc)
		if hour >= 0 && hour < 24 {
			hours[hour].ListenedMs += item.listened
			if item.qualified {
				hours[hour].Plays++
			}
		}
		day := LocalDay(item.started, loc)
		bucket := byDay[day]
		if bucket == nil {
			bucket = &DayBucket{Date: day}
			byDay[day] = bucket
		}
		bucket.ListenedMs += item.listened
		if item.qualified {
			bucket.Plays++
		}
		if first == 0 || item.started < first {
			first = item.started
		}
		if item.started > last {
			last = item.started
		}
	}
	axis := w
	if w.Unbounded {
		if first == 0 {
			return Activity{Days: []DayBucket{}, Hours: hours}
		}
		start := time.UnixMilli(first).In(loc)
		endMs := last
		today := time.Date(s.clock().In(loc).Year(), s.clock().In(loc).Month(), s.clock().In(loc).Day(), 0, 0, 0, 0, loc).UnixMilli()
		if today > endMs {
			endMs = today
		}
		end := time.UnixMilli(endMs).In(loc)
		from := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, loc)
		to := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 1)
		axis = Window{FromMs: from.UnixMilli(), ToMs: to.UnixMilli(), Loc: loc}
	}
	out := make([]DayBucket, 0, len(axis.eachDay()))
	for _, day := range axis.eachDay() {
		key := day.Format("2006-01-02")
		if bucket := byDay[key]; bucket != nil {
			out = append(out, *bucket)
			continue
		}
		out = append(out, DayBucket{Date: key})
	}
	return Activity{Days: out, Hours: hours}
}

func (s *Store) topTracks(w Window, limit, offset int) ([]TopTrack, error) {
	clause, args := w.andStarted()
	limit = bounded(limit, 20, 100)
	offset = nonNegative(offset)
	rows, err := s.db.Query(`WITH filtered AS (
		SELECT id, track_id, title, artist, artist_id, album, album_id, artwork_url, listened_ms, qualified, completed, started_at_ms
		FROM plays WHERE listened_ms > 0`+clause+`
	), ranked AS (
		SELECT track_id, SUM(listened_ms) AS listened_ms, SUM(qualified) AS plays, SUM(completed) AS completed,
			(
				SELECT f2.id FROM filtered f2 WHERE f2.track_id = filtered.track_id
				ORDER BY f2.started_at_ms DESC, f2.id DESC LIMIT 1
			) AS latest_id
		FROM filtered
		GROUP BY track_id
	)
	SELECT ranked.track_id, ranked.listened_ms, ranked.plays, ranked.completed,
		COALESCE(p.title, ''), COALESCE(p.artist, ''), COALESCE(p.artist_id, ''),
		COALESCE(p.album, ''), COALESCE(p.album_id, ''), COALESCE(p.artwork_url, '')
	FROM ranked
	LEFT JOIN plays p ON p.id = ranked.latest_id
	ORDER BY ranked.listened_ms DESC, ranked.track_id
	LIMIT ? OFFSET ?`, append(append([]any{}, args...), limit, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]TopTrack, 0)
	for rows.Next() {
		var item TopTrack
		if err := rows.Scan(&item.TrackID, &item.ListenedMs, &item.Plays, &item.Completed, &item.Title, &item.Artist, &item.ArtistID, &item.Album, &item.AlbumID, &item.ArtworkURL); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) topArtists(w Window, limit, offset int) ([]TopArtist, error) {
	clause, args := w.andStarted()
	limit = bounded(limit, 20, 100)
	offset = nonNegative(offset)
	rows, err := s.db.Query(`WITH keyed AS (
		SELECT id, track_id, artist, artist_id, artwork_url, listened_ms, qualified, started_at_ms,
			CASE WHEN artist_id != '' THEN artist_id ELSE lower(artist) END AS artist_key
		FROM plays
		WHERE listened_ms > 0 AND (artist != '' OR artist_id != '')`+clause+`
	), ranked AS (
		SELECT artist_key, SUM(listened_ms) AS listened_ms, SUM(qualified) AS plays, COUNT(DISTINCT track_id) AS tracks,
			(
				SELECT k2.id FROM keyed k2 WHERE k2.artist_key = keyed.artist_key
				ORDER BY k2.started_at_ms DESC, k2.id DESC LIMIT 1
			) AS latest_id
		FROM keyed
		GROUP BY artist_key
	)
	SELECT ranked.artist_key, ranked.listened_ms, ranked.plays, ranked.tracks,
		COALESCE(p.artist, ''), COALESCE(p.artist_id, ''), COALESCE(p.artwork_url, '')
	FROM ranked
	LEFT JOIN plays p ON p.id = ranked.latest_id
	ORDER BY ranked.listened_ms DESC, ranked.artist_key
	LIMIT ? OFFSET ?`, append(append([]any{}, args...), limit, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]TopArtist, 0)
	for rows.Next() {
		var item TopArtist
		var key string
		if err := rows.Scan(&key, &item.ListenedMs, &item.Plays, &item.Tracks, &item.Artist, &item.ArtistID, &item.ArtworkURL); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) topAlbums(w Window, limit, offset int) ([]TopAlbum, error) {
	clause, args := w.andStarted()
	limit = bounded(limit, 20, 100)
	offset = nonNegative(offset)
	rows, err := s.db.Query(`WITH keyed AS (
		SELECT id, artist, album, album_id, artwork_url, track_id, listened_ms, qualified, started_at_ms,
			CASE WHEN album_id != '' THEN 'id:' || album_id ELSE 'name:' || lower(album) || char(31) || lower(artist) END AS album_key
		FROM plays
		WHERE listened_ms > 0 AND (album != '' OR album_id != '')`+clause+`
	), ranked AS (
		SELECT album_key, SUM(listened_ms) AS listened_ms, SUM(qualified) AS plays, COUNT(DISTINCT track_id) AS tracks,
			(
				SELECT k2.id FROM keyed k2 WHERE k2.album_key = keyed.album_key
				ORDER BY k2.started_at_ms DESC, k2.id DESC LIMIT 1
			) AS latest_id
		FROM keyed
		GROUP BY album_key
	)
	SELECT ranked.album_key, ranked.listened_ms, ranked.plays, ranked.tracks,
		COALESCE(p.album, ''), COALESCE(p.album_id, ''), COALESCE(p.artist, ''), COALESCE(p.artwork_url, '')
	FROM ranked
	LEFT JOIN plays p ON p.id = ranked.latest_id
	ORDER BY ranked.listened_ms DESC, ranked.album_key
	LIMIT ? OFFSET ?`, append(append([]any{}, args...), limit, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]TopAlbum, 0)
	for rows.Next() {
		var item TopAlbum
		var key string
		if err := rows.Scan(&key, &item.ListenedMs, &item.Plays, &item.Tracks, &item.Album, &item.AlbumID, &item.Artist, &item.ArtworkURL); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) history(query string, fromMs, toMs int64, timezone string, limit, offset int) (HistoryPage, error) {
	loc, err := LoadLocation(timezone)
	if err != nil {
		return HistoryPage{}, err
	}
	limit = bounded(limit, 50, 200)
	offset = nonNegative(offset)
	where, args := historyFilter(query, fromMs, toMs)
	var total int64
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM plays WHERE `+where, args...).Scan(&total); err != nil {
		return HistoryPage{}, err
	}
	rows, err := s.db.Query(`SELECT `+playColumns+` FROM plays WHERE `+where+` ORDER BY started_at_ms DESC, id DESC LIMIT ? OFFSET ?`, append(append([]any{}, args...), limit, offset)...)
	if err != nil {
		return HistoryPage{}, err
	}
	defer rows.Close()
	items := make([]Play, 0)
	for rows.Next() {
		play, err := scanPlay(rows, loc)
		if err != nil {
			return HistoryPage{}, err
		}
		items = append(items, play)
	}
	if err := rows.Err(); err != nil {
		return HistoryPage{}, err
	}
	return HistoryPage{Items: items, Total: total}, nil
}

func historyFilter(query string, fromMs, toMs int64) (string, []any) {
	conds := []string{"listened_ms > 0"}
	args := make([]any, 0, 5)
	if text := strings.TrimSpace(query); text != "" {
		pattern := likeContains(text)
		conds = append(conds, `(title LIKE ? ESCAPE '\' OR artist LIKE ? ESCAPE '\' OR album LIKE ? ESCAPE '\')`)
		args = append(args, pattern, pattern, pattern)
	}
	if fromMs > 0 {
		conds = append(conds, "started_at_ms >= ?")
		args = append(args, fromMs)
	}
	if toMs > 0 {
		conds = append(conds, "started_at_ms < ?")
		args = append(args, toMs)
	}
	return strings.Join(conds, " AND "), args
}

func (s *Store) sessions(w Window, limit, offset int) (SessionPage, error) {
	clause, args := w.andStarted()
	limit = bounded(limit, 30, 100)
	offset = nonNegative(offset)
	var total int64
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM (
		SELECT session_id FROM plays WHERE listened_ms > 0`+clause+` GROUP BY session_id
	)`, args...).Scan(&total); err != nil {
		return SessionPage{}, err
	}
	rows, err := s.db.Query(`SELECT session_id, MIN(started_at_ms), MAX(ended_at_ms), SUM(listened_ms), SUM(qualified), COUNT(DISTINCT track_id)
		FROM plays
		WHERE listened_ms > 0 AND session_id IN (
			SELECT session_id FROM plays WHERE listened_ms > 0`+clause+`
		)
		GROUP BY session_id
		ORDER BY MAX(ended_at_ms) DESC
		LIMIT ? OFFSET ?`, append(append([]any{}, args...), limit, offset)...)
	if err != nil {
		return SessionPage{}, err
	}
	defer rows.Close()
	items := make([]SessionSummary, 0)
	for rows.Next() {
		var item SessionSummary
		if err := rows.Scan(&item.ID, &item.StartedAtMs, &item.EndedAtMs, &item.ListenedMs, &item.Plays, &item.Tracks); err != nil {
			return SessionPage{}, err
		}
		item.LocalDate = LocalDay(item.StartedAtMs, w.location())
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return SessionPage{}, err
	}
	return SessionPage{Items: items, Total: total}, nil
}

func (s *Store) session(id string) (SessionDetail, error) {
	if id == "" {
		return SessionDetail{}, errSessionNotFound
	}
	rows, err := s.db.Query(`SELECT `+playColumns+` FROM plays WHERE session_id = ? AND listened_ms > 0 ORDER BY started_at_ms ASC, id ASC`, id)
	if err != nil {
		return SessionDetail{}, err
	}
	defer rows.Close()
	plays := make([]Play, 0)
	for rows.Next() {
		play, err := scanPlay(rows, nil)
		if err != nil {
			return SessionDetail{}, err
		}
		plays = append(plays, play)
	}
	if err := rows.Err(); err != nil {
		return SessionDetail{}, err
	}
	if len(plays) == 0 {
		return SessionDetail{}, errSessionNotFound
	}
	summary := SessionSummary{ID: id, StartedAtMs: plays[0].StartedAtMs, EndedAtMs: plays[0].EndedAtMs}
	seen := map[string]struct{}{}
	for _, play := range plays {
		if play.StartedAtMs < summary.StartedAtMs {
			summary.StartedAtMs = play.StartedAtMs
		}
		if play.EndedAtMs > summary.EndedAtMs {
			summary.EndedAtMs = play.EndedAtMs
		}
		summary.ListenedMs += play.ListenedMs
		if play.Qualified {
			summary.Plays++
		}
		seen[play.TrackID] = struct{}{}
	}
	summary.Tracks = int64(len(seen))
	summary.LocalDate = LocalDay(summary.StartedAtMs, time.UTC)
	return SessionDetail{Session: summary, Plays: plays}, nil
}

func bounded(value, fallback, max int) int {
	if value <= 0 {
		return fallback
	}
	if value > max {
		return max
	}
	return value
}

func nonNegative(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func likeContains(query string) string {
	var b strings.Builder
	b.Grow(len(query) + 2)
	b.WriteByte('%')
	for _, r := range query {
		if r == '\\' || r == '%' || r == '_' {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	b.WriteByte('%')
	return b.String()
}

var errSessionNotFound = errors.New("listening session not found")

func (s *Store) SearchPreferences() (map[string]float64, error) {
	if err := s.lock(); err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	out := make(map[string]float64)
	if s.private {
		return out, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	rows, err := s.db.QueryContext(ctx, `SELECT track_id, COUNT(*) FROM plays
 WHERE qualified = 1 AND started_at_ms >= ? GROUP BY track_id
 HAVING COUNT(*) >= 3 ORDER BY COUNT(*) DESC, track_id LIMIT 500`, s.clock().AddDate(0, 0, -90).UnixMilli())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var count int
		if err := rows.Scan(&id, &count); err != nil {
			return nil, err
		}
		if id != "" {
			out[id] = min(1, float64(count)/10)
		}
	}
	return out, rows.Err()
}
