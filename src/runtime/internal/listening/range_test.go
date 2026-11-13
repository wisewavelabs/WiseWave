package listening

import (
	"testing"
	"time"
)

func TestResolveRangeKolkata(t *testing.T) {
	now := time.Date(2026, 6, 15, 23, 45, 0, 0, mustLoc(t, "Asia/Kolkata"))
	today, err := ResolveRange("Today", "Asia/Kolkata", now)
	if err != nil {
		t.Fatal(err)
	}
	wantFrom := time.Date(2026, 6, 14, 18, 30, 0, 0, time.UTC)
	wantTo := time.Date(2026, 6, 15, 18, 30, 0, 0, time.UTC)
	if today.FromMs != wantFrom.UnixMilli() || today.ToMs != wantTo.UnixMilli() {
		t.Fatalf("today = [%s, %s)", time.UnixMilli(today.FromMs).UTC(), time.UnixMilli(today.ToMs).UTC())
	}
	late := time.Date(2026, 6, 15, 23, 30, 0, 0, today.location()).UnixMilli()
	earlyNext := time.Date(2026, 6, 16, 0, 30, 0, 0, today.location()).UnixMilli()
	if LocalDay(late, today.location()) != "2026-06-15" {
		t.Fatalf("late local day = %s", LocalDay(late, today.location()))
	}
	if LocalDay(earlyNext, today.location()) != "2026-06-16" {
		t.Fatalf("next local day = %s", LocalDay(earlyNext, today.location()))
	}
	utcEvening := time.Date(2026, 6, 15, 19, 0, 0, 0, time.UTC).UnixMilli()
	if LocalDay(utcEvening, today.location()) != "2026-06-16" {
		t.Fatalf("UTC 19:00 local day = %s", LocalDay(utcEvening, today.location()))
	}

	week, err := ResolveRange("7 Days", "Asia/Kolkata", now)
	if err != nil {
		t.Fatal(err)
	}
	if len(week.eachDay()) != 7 {
		t.Fatalf("7 days produced %d dates", len(week.eachDay()))
	}
	if LocalDay(week.FromMs, week.location()) != "2026-06-09" || LocalDay(week.ToMs-1, week.location()) != "2026-06-15" {
		t.Fatalf("7 day span %s .. %s", LocalDay(week.FromMs, week.location()), LocalDay(week.ToMs-1, week.location()))
	}

	month, err := ResolveRange("This Month", "Asia/Kolkata", now)
	if err != nil {
		t.Fatal(err)
	}
	if LocalDay(month.FromMs, month.location()) != "2026-06-01" || LocalDay(month.ToMs-1, month.location()) != "2026-06-30" {
		t.Fatalf("month span %s .. %s", LocalDay(month.FromMs, month.location()), LocalDay(month.ToMs-1, month.location()))
	}

	year, err := ResolveRange("This Year", "Asia/Kolkata", now)
	if err != nil {
		t.Fatal(err)
	}
	if LocalDay(year.FromMs, year.location()) != "2026-01-01" || LocalDay(year.ToMs-1, year.location()) != "2026-12-31" {
		t.Fatalf("year span %s .. %s", LocalDay(year.FromMs, year.location()), LocalDay(year.ToMs-1, year.location()))
	}

	all, err := ResolveRange("All Time", "Asia/Kolkata", now)
	if err != nil {
		t.Fatal(err)
	}
	if !all.Unbounded {
		t.Fatal("all time should be unbounded")
	}
}

func TestResolveRangeDST(t *testing.T) {
	loc := mustLoc(t, "America/New_York")
	spring := time.Date(2026, 3, 8, 12, 0, 0, 0, loc)
	today, err := ResolveRange("today", "America/New_York", spring)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 3, 8, 0, 0, 0, 0, loc)
	end := time.Date(2026, 3, 9, 0, 0, 0, 0, loc)
	if today.FromMs != start.UnixMilli() || today.ToMs != end.UnixMilli() {
		t.Fatalf("spring bounds [%d, %d) want [%d, %d)", today.FromMs, today.ToMs, start.UnixMilli(), end.UnixMilli())
	}
	if today.ToMs-today.FromMs != 23*time.Hour.Milliseconds() {
		t.Fatalf("spring-forward day length = %d ms", today.ToMs-today.FromMs)
	}
	at0130 := time.Date(2026, 3, 8, 1, 30, 0, 0, loc).UnixMilli()
	prevLate := time.Date(2026, 3, 7, 23, 30, 0, 0, loc).UnixMilli()
	if !today.includes(at0130) || today.includes(prevLate) {
		t.Fatalf("spring today includes 01:30=%v previous 23:30=%v", today.includes(at0130), today.includes(prevLate))
	}
	if LocalDay(at0130, loc) != "2026-03-08" || LocalDay(prevLate, loc) != "2026-03-07" {
		t.Fatalf("spring days %s %s", LocalDay(at0130, loc), LocalDay(prevLate, loc))
	}

	fall := time.Date(2026, 11, 1, 12, 0, 0, 0, loc)
	fallDay, err := ResolveRange("today", "America/New_York", fall)
	if err != nil {
		t.Fatal(err)
	}
	if fallDay.ToMs-fallDay.FromMs != 25*time.Hour.Milliseconds() {
		t.Fatalf("fall-back day length = %d ms", fallDay.ToMs-fallDay.FromMs)
	}
	repeated := time.Date(2026, 11, 1, 1, 30, 0, 0, loc).UnixMilli()
	if LocalDay(repeated, loc) != "2026-11-01" || !fallDay.includes(repeated) {
		t.Fatalf("fall 01:30 day=%s included=%v", LocalDay(repeated, loc), fallDay.includes(repeated))
	}

	weekNow := time.Date(2026, 3, 10, 15, 0, 0, 0, loc)
	week, err := ResolveRange("7d", "America/New_York", weekNow)
	if err != nil {
		t.Fatal(err)
	}
	days := week.eachDay()
	if len(days) != 7 {
		t.Fatalf("DST week has %d days", len(days))
	}
	if days[0].Format("2006-01-02") != "2026-03-04" || days[6].Format("2006-01-02") != "2026-03-10" {
		t.Fatalf("DST week %s .. %s", days[0].Format("2006-01-02"), days[6].Format("2006-01-02"))
	}
}

func TestResolveRangeRejectsUnknown(t *testing.T) {
	if _, err := ResolveRange("today", "Not/AZone", time.Now()); err == nil {
		t.Fatal("expected invalid timezone")
	}
	if _, err := ResolveRange("fortnight", "UTC", time.Now()); err == nil {
		t.Fatal("expected unknown range")
	}
}

func TestYearWindowLeapAndDST(t *testing.T) {
	leap, err := YearWindow(2024, "UTC", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(leap.eachDay()) != 366 {
		t.Fatalf("2024 days = %d", len(leap.eachDay()))
	}
	year, err := YearWindow(2026, "America/New_York", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	days := year.eachDay()
	if len(days) != 365 {
		t.Fatalf("2026 New York days = %d", len(days))
	}
	if days[0].Format("2006-01-02") != "2026-01-01" || days[len(days)-1].Format("2006-01-02") != "2026-12-31" {
		t.Fatalf("span %s .. %s", days[0].Format("2006-01-02"), days[len(days)-1].Format("2006-01-02"))
	}
}

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return loc
}
