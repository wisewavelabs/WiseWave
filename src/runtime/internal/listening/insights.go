package listening

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"
)

const (
	insightMinListenMs = 30 * 60 * 1000
	onRepeatMinPlays   = 3
	discoveryMinTracks = 3
	streakMinDays      = 2
)

func (s *Store) Insights(rangeName, timezone string) ([]Insight, error) {
	if err := s.lock(); err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	w, err := s.window(rangeName, timezone)
	if err != nil {
		return nil, err
	}
	return s.insights(w)
}

func (s *Store) Rewind(kind string, year, month int, timezone string) (Rewind, error) {
	if err := s.lock(); err != nil {
		return Rewind{}, err
	}
	defer s.mu.Unlock()
	w, kind, year, month, err := s.rewindWindow(kind, year, month, timezone)
	if err != nil {
		return Rewind{}, err
	}
	return s.rewind(w, kind, year, month)
}

func (s *Store) insights(w Window) ([]Insight, error) {
	out := make([]Insight, 0)
	repeat, ok, err := s.onRepeat(w)
	if err != nil {
		return nil, err
	}
	if ok {
		out = append(out, repeat)
	}
	samples, err := s.loadSamples(w)
	if err != nil {
		return nil, err
	}
	if bird := daypartInsight(samples, w.location()); bird != nil {
		out = append(out, *bird)
	}
	found, ok, err := s.discoveries(w)
	if err != nil {
		return nil, err
	}
	if ok {
		out = append(out, found)
	}
	favorite, ok, err := s.oldFavorite(w)
	if err != nil {
		return nil, err
	}
	if ok {
		out = append(out, favorite)
	}
	out = append(out, streakInsights(samples, w, s.clock())...)
	overview, err := s.overview(w)
	if err != nil {
		return nil, err
	}
	out = append(out, milestoneInsights(overview)...)
	return out, nil
}

func (s *Store) onRepeat(w Window) (Insight, bool, error) {
	clause, args := w.andStarted()
	var trackID string
	var plays, listened int64
	err := s.db.QueryRow(`SELECT track_id, SUM(qualified), SUM(listened_ms)
		FROM plays WHERE qualified = 1`+clause+`
		GROUP BY track_id
		HAVING SUM(qualified) >= ?
		ORDER BY SUM(qualified) DESC, SUM(listened_ms) DESC, track_id
		LIMIT 1`, append(args, onRepeatMinPlays)...).Scan(&trackID, &plays, &listened)
	if errors.Is(err, sql.ErrNoRows) {
		return Insight{}, false, nil
	}
	if err != nil {
		return Insight{}, false, err
	}
	title, artist, _, _, _, art, err := s.latestMeta(w, "track_id = ?", trackID)
	if err != nil {
		return Insight{}, false, err
	}
	return Insight{
		Kind:       InsightOnRepeat,
		Title:      "On Repeat",
		Detail:     playedTimes(title, artist, plays),
		TrackID:    trackID,
		TrackTitle: title,
		Artist:     artist,
		ArtworkURL: art,
		Value:      plays,
	}, true, nil
}

func (s *Store) discoveries(w Window) (Insight, bool, error) {
	if w.Unbounded {
		return Insight{}, false, nil
	}
	var count int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM (
		SELECT track_id FROM plays WHERE listened_ms > 0
		GROUP BY track_id
		HAVING MIN(started_at_ms) >= ? AND MIN(started_at_ms) < ?
			AND SUM(CASE WHEN qualified = 1 AND started_at_ms >= ? AND started_at_ms < ? THEN 1 ELSE 0 END) > 0
	)`, w.FromMs, w.ToMs, w.FromMs, w.ToMs).Scan(&count)
	if err != nil {
		return Insight{}, false, err
	}
	if count < discoveryMinTracks {
		return Insight{}, false, nil
	}
	return Insight{
		Kind:   InsightDiscoveries,
		Title:  "Discoveries",
		Detail: fmt.Sprintf("%d tracks you heard for the first time", count),
		Value:  count,
	}, true, nil
}

func (s *Store) oldFavorite(w Window) (Insight, bool, error) {
	if w.Unbounded {
		return Insight{}, false, nil
	}
	var trackID string
	var listened int64
	err := s.db.QueryRow(`SELECT track_id, SUM(listened_ms) FROM plays
		WHERE listened_ms > 0 AND qualified = 1 AND started_at_ms >= ? AND started_at_ms < ?
			AND track_id IN (SELECT track_id FROM plays WHERE listened_ms > 0 AND started_at_ms < ?)
		GROUP BY track_id
		ORDER BY SUM(listened_ms) DESC, track_id
		LIMIT 1`, w.FromMs, w.ToMs, w.FromMs).Scan(&trackID, &listened)
	if errors.Is(err, sql.ErrNoRows) {
		return Insight{}, false, nil
	}
	if err != nil {
		return Insight{}, false, err
	}
	title, artist, _, _, _, art, err := s.latestMeta(w, "track_id = ?", trackID)
	if err != nil {
		return Insight{}, false, err
	}
	detail := fmt.Sprintf("You came back to %s", title)
	if artist != "" {
		detail = fmt.Sprintf("You came back to %s by %s", title, artist)
	}
	return Insight{
		Kind:       InsightOldFavorite,
		Title:      "Old Favorite",
		Detail:     detail,
		TrackID:    trackID,
		TrackTitle: title,
		Artist:     artist,
		ArtworkURL: art,
		Value:      listened,
	}, true, nil
}

func (s *Store) latestMeta(w Window, match string, arg any) (title, artist, artistID, album, albumID, art string, err error) {
	clause, args := w.andStarted()
	queryArgs := append([]any{arg}, args...)
	err = s.db.QueryRow(`SELECT title, artist, artist_id, album, album_id, artwork_url FROM plays
		WHERE listened_ms > 0 AND `+match+clause+`
		ORDER BY started_at_ms DESC, id DESC LIMIT 1`, queryArgs...).Scan(&title, &artist, &artistID, &album, &albumID, &art)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", "", "", "", "", nil
	}
	return title, artist, artistID, album, albumID, art, err
}

func daypartInsight(samples []sample, loc *time.Location) *Insight {
	var total, night, early int64
	for _, item := range samples {
		total += item.listened
		switch hour := LocalHour(item.started, loc); {
		case hour >= 22 || hour < 5:
			night += item.listened
		case hour >= 5 && hour < 9:
			early += item.listened
		}
	}
	if total < insightMinListenMs {
		return nil
	}
	if night > early && night*2 >= total {
		pct := night * 100 / total
		return &Insight{Kind: InsightNightOwl, Title: "Night Owl", Detail: fmt.Sprintf("%d%% of your listening was between 10 PM and 5 AM", pct), Value: pct}
	}
	if early > night && early*2 >= total {
		pct := early * 100 / total
		return &Insight{Kind: InsightEarlyBird, Title: "Early Bird", Detail: fmt.Sprintf("%d%% of your listening was between 5 AM and 9 AM", pct), Value: pct}
	}
	return nil
}

func streakInsights(samples []sample, w Window, now time.Time) []Insight {
	loc := w.location()
	days := make([]string, 0)
	seen := map[string]struct{}{}
	for _, item := range samples {
		if !item.qualified {
			continue
		}
		day := LocalDay(item.started, loc)
		if _, ok := seen[day]; ok {
			continue
		}
		seen[day] = struct{}{}
		days = append(days, day)
	}
	nowMs := now.UnixMilli()
	current, longest := streakLengths(days, LocalDay(nowMs, loc), w.includes(nowMs))
	out := make([]Insight, 0, 2)
	if w.includes(nowMs) && current >= streakMinDays {
		out = append(out, Insight{Kind: InsightStreak, Title: "Current Streak", Detail: strconv.Itoa(current) + " days in a row", Value: int64(current)})
	}
	if longest >= streakMinDays && (!w.includes(nowMs) || longest > current) {
		out = append(out, Insight{Kind: InsightLongestStreak, Title: "Longest Streak", Detail: strconv.Itoa(longest) + " days", Value: int64(longest)})
	}
	return out
}

func streakLengths(days []string, today string, includeCurrent bool) (current, longest int) {
	if len(days) == 0 {
		return 0, 0
	}
	parsed := make([]time.Time, 0, len(days))
	set := map[string]struct{}{}
	for _, day := range days {
		if _, ok := set[day]; ok {
			continue
		}
		set[day] = struct{}{}
		value, err := time.ParseInLocation("2006-01-02", day, time.UTC)
		if err != nil {
			continue
		}
		parsed = append(parsed, value)
	}
	if len(parsed) == 0 {
		return 0, 0
	}
	sort.Slice(parsed, func(i, j int) bool { return parsed[i].Before(parsed[j]) })
	run := 1
	longest = 1
	for i := 1; i < len(parsed); i++ {
		if parsed[i].Equal(parsed[i-1].AddDate(0, 0, 1)) {
			run++
			if run > longest {
				longest = run
			}
			continue
		}
		run = 1
	}
	if !includeCurrent {
		return 0, longest
	}
	cursor, err := time.ParseInLocation("2006-01-02", today, time.UTC)
	if err != nil {
		return 0, longest
	}
	if _, ok := set[today]; !ok {
		cursor = cursor.AddDate(0, 0, -1)
	}
	for {
		if _, ok := set[cursor.Format("2006-01-02")]; !ok {
			break
		}
		current++
		cursor = cursor.AddDate(0, 0, -1)
	}
	return current, longest
}

func milestoneInsights(overview Overview) []Insight {
	out := make([]Insight, 0, 2)
	if ms, ok := highestAtLeast(overview.ListenedMs, listenMilestones); ok {
		hours := ms / time.Hour.Milliseconds()
		detail := strconv.FormatInt(hours, 10) + " hours listened"
		if hours == 1 {
			detail = "1 hour listened"
		}
		out = append(out, Insight{Kind: InsightMilestoneTime, Title: "Milestone", Detail: detail, Value: hours})
	}
	if plays, ok := highestAtLeast(overview.Plays, playMilestones); ok {
		out = append(out, Insight{Kind: InsightMilestonePlays, Title: "Milestone", Detail: strconv.FormatInt(plays, 10) + " plays", Value: plays})
	}
	return out
}

var listenMilestones = []int64{
	time.Hour.Milliseconds(),
	5 * time.Hour.Milliseconds(),
	10 * time.Hour.Milliseconds(),
	24 * time.Hour.Milliseconds(),
	50 * time.Hour.Milliseconds(),
	100 * time.Hour.Milliseconds(),
	250 * time.Hour.Milliseconds(),
	500 * time.Hour.Milliseconds(),
	1000 * time.Hour.Milliseconds(),
}

var playMilestones = []int64{10, 25, 50, 100, 250, 500, 1000, 2500, 5000}

func highestAtLeast(value int64, steps []int64) (int64, bool) {
	var best int64
	found := false
	for _, step := range steps {
		if value >= step {
			best = step
			found = true
		}
	}
	return best, found
}

func playedTimes(title, artist string, plays int64) string {
	if artist == "" {
		return fmt.Sprintf("Played %s %d times", title, plays)
	}
	return fmt.Sprintf("Played %s by %s %d times", title, artist, plays)
}

func (s *Store) rewindWindow(kind string, year, month int, timezone string) (Window, string, int, int, error) {
	canon, err := canonicalPeriod(kind)
	if err != nil {
		return Window{}, "", 0, 0, err
	}
	loc, err := LoadLocation(timezone)
	if err != nil {
		return Window{}, "", 0, 0, err
	}
	now := s.clock().In(loc)
	if year <= 0 {
		year = now.Year()
	}
	if year < 1970 || year > 9999 {
		return Window{}, "", 0, 0, fmt.Errorf("invalid rewind year %d", year)
	}
	var start, end time.Time
	if canon == PeriodMonth {
		if month <= 0 {
			month = int(now.Month())
		}
		if month < 1 || month > 12 {
			return Window{}, "", 0, 0, fmt.Errorf("invalid rewind month %d", month)
		}
		start = time.Date(year, time.Month(month), 1, 0, 0, 0, 0, loc)
		end = start.AddDate(0, 1, 0)
	} else {
		month = 0
		start = time.Date(year, time.January, 1, 0, 0, 0, 0, loc)
		end = start.AddDate(1, 0, 0)
	}
	return Window{Name: canon, FromMs: start.UnixMilli(), ToMs: end.UnixMilli(), Loc: loc}, canon, year, month, nil
}

func (s *Store) rewind(w Window, kind string, year, month int) (Rewind, error) {
	overview, err := s.overview(w)
	if err != nil {
		return Rewind{}, err
	}
	tracks, err := s.topTracks(w, 5, 0)
	if err != nil {
		return Rewind{}, err
	}
	artists, err := s.topArtists(w, 5, 0)
	if err != nil {
		return Rewind{}, err
	}
	albums, err := s.topAlbums(w, 5, 0)
	if err != nil {
		return Rewind{}, err
	}
	samples, err := s.loadSamples(w)
	if err != nil {
		return Rewind{}, err
	}
	act := s.activity(w, samples)
	insights, err := s.insights(w)
	if err != nil {
		return Rewind{}, err
	}
	label := strconv.Itoa(year)
	if kind == PeriodMonth {
		label = time.Month(month).String() + " " + strconv.Itoa(year)
	}
	return Rewind{
		Kind:       kind,
		Year:       year,
		Month:      month,
		Label:      label,
		ListenedMs: overview.ListenedMs,
		Plays:      overview.Plays,
		Tracks:     overview.Tracks,
		Artists:    overview.Artists,
		Albums:     overview.Albums,
		Completed:  overview.Completed,
		TopTracks:  tracks,
		TopArtists: artists,
		TopAlbums:  albums,
		BusiestDay: busiestDay(act.Days),
		Insights:   insights,
	}, nil
}

func busiestDay(days []DayBucket) *DayBucket {
	var best *DayBucket
	for i := range days {
		if days[i].ListenedMs <= 0 {
			continue
		}
		if best == nil || days[i].ListenedMs >= best.ListenedMs {
			day := days[i]
			best = &day
		}
	}
	return best
}
