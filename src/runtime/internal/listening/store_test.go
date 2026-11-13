package listening

import (
	"path/filepath"
	"testing"
	"time"
)

func TestSessionGap(t *testing.T) {
	store := newTestStore(t)
	start := time.Date(2026, 4, 1, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return start }
	mustHear(t, store, "a", 40_000, 180_000, start)
	mustFinalize(t, store)

	same := start.Add(SessionGap)
	store.now = func() time.Time { return same }
	mustHear(t, store, "b", 40_000, 180_000, same)
	mustFinalize(t, store)

	page := mustHistory(t, store)
	if len(page.Items) != 2 {
		t.Fatalf("plays = %d", len(page.Items))
	}
	if page.Items[0].SessionID == "" || page.Items[0].SessionID != page.Items[1].SessionID {
		t.Fatalf("30m gap split sessions %s %s", page.Items[0].SessionID, page.Items[1].SessionID)
	}

	next := same.Add(SessionGap + time.Millisecond)
	store.now = func() time.Time { return next }
	mustHear(t, store, "c", 40_000, 180_000, next)
	mustFinalize(t, store)
	page = mustHistory(t, store)
	if len(page.Items) != 3 {
		t.Fatalf("plays = %d", len(page.Items))
	}
	if page.Items[0].SessionID == page.Items[1].SessionID {
		t.Fatal("gap past 30m kept the same session")
	}
	if page.Items[1].SessionID != page.Items[2].SessionID {
		t.Fatal("earlier plays changed session")
	}

	sessions, err := store.Sessions("all", "UTC", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if sessions.Total != 2 || len(sessions.Items) != 2 {
		t.Fatalf("sessions = %+v", sessions)
	}
	detail, err := store.Session(page.Items[1].SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Plays) != 2 || detail.Session.Tracks != 2 {
		t.Fatalf("detail = %+v plays=%d", detail.Session, len(detail.Plays))
	}
}

func TestHeartbeatMergesAndPrivateNoop(t *testing.T) {
	store := newTestStore(t)
	when := time.Date(2026, 5, 2, 15, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return when }
	started := when.UnixMilli()

	if err := store.Heartbeat(Heartbeat{TrackID: "song", Title: "Song", Artist: "Ada", ListenedMs: 40_000, TrackDurationMs: 180_000, StartedAtMs: started, Private: true}); err != nil {
		t.Fatal(err)
	}
	if page := mustHistory(t, store); page.Total != 0 {
		t.Fatalf("private heartbeat stored %d plays", page.Total)
	}

	mustHear(t, store, "song", 12_000, 180_000, when)
	if err := store.Heartbeat(Heartbeat{TrackID: "song", Title: "Song", Artist: "Ada", ListenedMs: 90_000, TrackDurationMs: 180_000, StartedAtMs: started, Private: true}); err != nil {
		t.Fatal(err)
	}
	open := mustHistory(t, store)
	if open.Total != 1 || open.Items[0].ListenedMs != 12_000 {
		t.Fatalf("private update changed the play: %+v", open.Items)
	}

	mustHear(t, store, "song", 40_000, 180_000, when)
	mustHear(t, store, "song", 5_000, 180_000, when)
	page := mustHistory(t, store)
	if page.Total != 1 || page.Items[0].ListenedMs != 40_000 || !page.Items[0].Qualified || page.Items[0].Completed {
		t.Fatalf("merged play = %+v", page.Items[0])
	}

	mustFinalize(t, store)
	store.SetPrivate(true)
	later := when.Add(time.Minute)
	store.now = func() time.Time { return later }
	if err := store.Heartbeat(Heartbeat{TrackID: "other", Title: "Other", ListenedMs: 40_000, TrackDurationMs: 180_000, StartedAtMs: later.UnixMilli()}); err != nil {
		t.Fatal(err)
	}
	if page = mustHistory(t, store); page.Total != 1 {
		t.Fatalf("private mode stored a play: %+v", page.Items)
	}

	store.SetPrivate(false)
	mustHear(t, store, "other", 40_000, 180_000, later)
	if err := store.Discard(); err != nil {
		t.Fatal(err)
	}
	if page = mustHistory(t, store); page.Total != 1 || page.Items[0].TrackID != "song" {
		t.Fatalf("discard left %+v", page.Items)
	}
}

func TestShortAndUnknownQualificationStored(t *testing.T) {
	store := newTestStore(t)
	when := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return when }
	mustHear(t, store, "short", 10_000, 20_000, when)
	mustFinalize(t, store)

	under := when.Add(time.Minute)
	store.now = func() time.Time { return under }
	mustHear(t, store, "long", 29_000, 240_000, under)
	mustFinalize(t, store)

	unknown := under.Add(time.Minute)
	store.now = func() time.Time { return unknown }
	mustHear(t, store, "unknown", 30_000, 0, unknown)
	mustFinalize(t, store)

	full := unknown.Add(time.Minute)
	store.now = func() time.Time { return full }
	mustHear(t, store, "full", 18_000, 20_000, full)
	mustFinalize(t, store)

	page := mustHistory(t, store)
	got := map[string]Play{}
	for _, item := range page.Items {
		got[item.TrackID] = item
	}
	if !got["short"].Qualified || got["short"].Completed {
		t.Fatalf("short = %+v", got["short"])
	}
	if got["long"].Qualified || got["long"].Completed {
		t.Fatalf("long = %+v", got["long"])
	}
	if !got["unknown"].Qualified || got["unknown"].Completed {
		t.Fatalf("unknown = %+v", got["unknown"])
	}
	if !got["full"].Qualified || !got["full"].Completed {
		t.Fatalf("full = %+v", got["full"])
	}
}

func TestActivityBucketsIANADays(t *testing.T) {
	store := newTestStore(t)
	loc := mustLoc(t, "Asia/Kolkata")
	late := time.Date(2026, 6, 15, 23, 30, 0, 0, loc)
	next := time.Date(2026, 6, 16, 0, 30, 0, 0, loc)
	store.now = func() time.Time { return next }
	mustHear(t, store, "late", 40_000, 180_000, late)
	mustFinalize(t, store)
	mustHear(t, store, "next", 40_000, 180_000, next)
	mustFinalize(t, store)

	activity, err := store.Activity("7 days", "Asia/Kolkata")
	if err != nil {
		t.Fatal(err)
	}
	if len(activity.Hours) != 24 {
		t.Fatalf("hours = %d", len(activity.Hours))
	}
	days := map[string]DayBucket{}
	for _, day := range activity.Days {
		days[day.Date] = day
	}
	if days["2026-06-15"].ListenedMs != 40_000 || days["2026-06-16"].ListenedMs != 40_000 {
		t.Fatalf("days = %+v", days)
	}
	if days["2026-06-14"].Date != "2026-06-14" || days["2026-06-14"].ListenedMs != 0 {
		t.Fatalf("missing empty day: %+v", days["2026-06-14"])
	}
	if activity.Hours[23].ListenedMs != 40_000 || activity.Hours[0].ListenedMs != 40_000 {
		t.Fatalf("hours 23=%d 0=%d", activity.Hours[23].ListenedMs, activity.Hours[0].ListenedMs)
	}
}

func TestTopListsAndRewind(t *testing.T) {
	store := newTestStore(t)
	when := time.Date(2026, 8, 3, 18, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return when }
	mustHear(t, store, "alpha", 50_000, 180_000, when)
	mustFinalize(t, store)
	later := when.Add(time.Minute)
	store.now = func() time.Time { return later }
	if err := store.Heartbeat(Heartbeat{
		TrackID: "beta", Title: "Beta", Artist: "Bea", ArtistID: "artist-bea",
		Album: "Other", AlbumID: "album-2", ArtworkURL: "https://example.test/beta.jpg",
		ListenedMs: 80_000, TrackDurationMs: 180_000, StartedAtMs: later.UnixMilli(),
	}); err != nil {
		t.Fatal(err)
	}
	mustFinalize(t, store)

	tracks, err := store.TopTracks("This Year", "UTC", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(tracks) != 2 || tracks[0].TrackID != "beta" || tracks[0].Title != "Beta" || tracks[0].ListenedMs != 80_000 {
		t.Fatalf("tracks = %+v", tracks)
	}
	artists, err := store.TopArtists("year", "UTC", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(artists) != 2 || artists[0].Artist != "Bea" || artists[1].Artist != "Ada" {
		t.Fatalf("artists = %+v", artists)
	}
	albums, err := store.TopAlbums("year", "UTC", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(albums) != 2 || albums[0].Album != "Other" {
		t.Fatalf("albums = %+v", albums)
	}
	rewind, err := store.Rewind("month", 2026, 8, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	if rewind.Label != "August 2026" || rewind.Plays != 2 || rewind.Tracks != 2 || len(rewind.TopTracks) != 2 {
		t.Fatalf("rewind = %+v", rewind)
	}
	found, err := store.History("be", 0, 0, "UTC", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if found.Total != 1 || found.Items[0].TrackID != "beta" {
		t.Fatalf("history = %+v", found.Items)
	}
}

func TestAttemptIDDedupesAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "listening.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	when := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return when }
	attempt := "attempt-stable-1"
	if err := store.Heartbeat(Heartbeat{
		AttemptID: attempt, TrackID: "song", Title: "Song", Artist: "Ada",
		ListenedMs: 20_000, TrackDurationMs: 180_000, StartedAtMs: when.UnixMilli(),
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	later := when.Add(30 * time.Second)
	reopened.now = func() time.Time { return later }
	if err := reopened.Heartbeat(Heartbeat{
		AttemptID: attempt, TrackID: "song", Title: "Song", Artist: "Ada",
		ListenedMs: 55_000, TrackDurationMs: 180_000, StartedAtMs: when.UnixMilli(),
	}); err != nil {
		t.Fatal(err)
	}
	if err := reopened.Heartbeat(Heartbeat{
		AttemptID: attempt, TrackID: "song", Title: "Song", Artist: "Ada",
		ListenedMs: 55_000, TrackDurationMs: 180_000, StartedAtMs: when.UnixMilli(),
	}); err != nil {
		t.Fatal(err)
	}
	page := mustHistory(t, reopened)
	if page.Total != 1 || page.Items[0].ListenedMs != 55_000 || page.Items[0].AttemptID != attempt {
		t.Fatalf("attempt dedupe = %+v", page.Items)
	}
}

func TestClearAndReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "listening.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	when := time.Date(2026, 1, 2, 8, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return when }
	mustHear(t, store, "keep", 40_000, 180_000, when)
	mustFinalize(t, store)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	reopened.now = store.now
	page := mustHistory(t, reopened)
	if page.Total != 1 || page.Items[0].TrackID != "keep" {
		t.Fatalf("reopen = %+v", page.Items)
	}
	if err := reopened.Clear(); err != nil {
		t.Fatal(err)
	}
	page = mustHistory(t, reopened)
	if page.Total != 0 {
		t.Fatalf("clear left %d", page.Total)
	}
}

func TestInsightsOmitWithoutEvidence(t *testing.T) {
	store := newTestStore(t)
	when := time.Date(2026, 5, 2, 23, 10, 0, 0, time.UTC)
	store.now = func() time.Time { return when }
	insights, err := store.Insights("today", "UTC")
	if err != nil {
		t.Fatal(err)
	}
	if len(insights) != 0 {
		t.Fatalf("empty insights = %+v", insights)
	}

	mustHear(t, store, "night", int64(40*time.Minute/time.Millisecond), int64(50*time.Minute/time.Millisecond), when)
	mustFinalize(t, store)
	insights, err = store.Insights("today", "UTC")
	if err != nil {
		t.Fatal(err)
	}
	if !hasKind(insights, InsightNightOwl) || hasKind(insights, InsightOnRepeat) {
		t.Fatalf("night insights = %+v", insights)
	}

	for i := 0; i < 2; i++ {
		at := when.Add(time.Duration(i+1) * time.Minute)
		store.now = func() time.Time { return at }
		mustHear(t, store, "night", 40_000, 180_000, at)
		mustFinalize(t, store)
	}
	insights, err = store.Insights("all", "UTC")
	if err != nil {
		t.Fatal(err)
	}
	if !hasKind(insights, InsightOnRepeat) {
		t.Fatalf("missing on repeat: %+v", insights)
	}
}

func TestStreakAcrossDays(t *testing.T) {
	store := newTestStore(t)
	base := time.Date(2026, 5, 4, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return base }
	for _, day := range []int{2, 3, 4} {
		at := time.Date(2026, 5, day, 12, 0, 0, 0, time.UTC)
		store.now = func() time.Time { return at }
		mustHear(t, store, "day-"+time.Date(2026, 5, day, 0, 0, 0, 0, time.UTC).Format("02"), 40_000, 180_000, at)
		mustFinalize(t, store)
	}
	insights, err := store.Insights("7 days", "UTC")
	if err != nil {
		t.Fatal(err)
	}
	streak, ok := findKind(insights, InsightStreak)
	if !ok || streak.Value != 3 {
		t.Fatalf("streak = %+v all=%+v", streak, insights)
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "listening.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("close: %v", err)
		}
	})
	return store
}

func mustHear(t *testing.T, store *Store, id string, listened, duration int64, at time.Time) {
	t.Helper()
	err := store.Heartbeat(Heartbeat{
		TrackID: id, Title: id, Artist: "Ada", ArtistID: "artist-ada",
		Album: "Album", AlbumID: "album-1", ArtworkURL: "https://example.test/" + id + ".jpg",
		ListenedMs: listened, TrackDurationMs: duration, StartedAtMs: at.UnixMilli(),
	})
	if err != nil {
		t.Fatal(err)
	}
}

func mustFinalize(t *testing.T, store *Store) {
	t.Helper()
	if err := store.Finalize(); err != nil {
		t.Fatal(err)
	}
}

func mustHistory(t *testing.T, store *Store) HistoryPage {
	t.Helper()
	page, err := store.History("", 0, 0, "UTC", 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	return page
}

func hasKind(insights []Insight, kind string) bool {
	_, ok := findKind(insights, kind)
	return ok
}

func findKind(insights []Insight, kind string) (Insight, bool) {
	for _, insight := range insights {
		if insight.Kind == kind {
			return insight, true
		}
	}
	return Insight{}, false
}
