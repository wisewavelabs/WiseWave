package listening

import (
	"fmt"
	"strings"
	"time"
	_ "time/tzdata"
)

const (
	RangeToday  = "today"
	Range7Days  = "7d"
	Range30Days = "30d"
	RangeMonth  = "month"
	RangeYear   = "year"
	RangeAll    = "all"
	PeriodMonth = "month"
	PeriodYear  = "year"
)

type Window struct {
	Name      string
	FromMs    int64
	ToMs      int64
	Loc       *time.Location
	Unbounded bool
}

func (w Window) location() *time.Location {
	if w.Loc == nil {
		return time.UTC
	}
	return w.Loc
}

func (w Window) includes(ms int64) bool {
	if w.Unbounded {
		return true
	}
	return ms >= w.FromMs && ms < w.ToMs
}

func (w Window) andStarted() (string, []any) {
	if w.Unbounded {
		return "", nil
	}
	return " AND started_at_ms >= ? AND started_at_ms < ?", []any{w.FromMs, w.ToMs}
}

func LoadLocation(timezone string) (*time.Location, error) {
	timezone = strings.TrimSpace(timezone)
	switch {
	case timezone == "" || strings.EqualFold(timezone, "local"):
		return time.Local, nil
	case strings.EqualFold(timezone, "utc") || timezone == "Z":
		return time.UTC, nil
	default:
		loc, err := time.LoadLocation(timezone)
		if err != nil {
			return nil, fmt.Errorf("invalid timezone %q", timezone)
		}
		return loc, nil
	}
}

func ResolveRange(name, timezone string, now time.Time) (Window, error) {
	canon, err := canonicalRange(name)
	if err != nil {
		return Window{}, err
	}
	loc, err := LoadLocation(timezone)
	if err != nil {
		return Window{}, err
	}
	local := now.In(loc)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	tomorrow := today.AddDate(0, 0, 1)
	w := Window{Name: canon, Loc: loc}
	switch canon {
	case RangeToday:
		w.FromMs = today.UnixMilli()
		w.ToMs = tomorrow.UnixMilli()
	case Range7Days:
		w.FromMs = today.AddDate(0, 0, -6).UnixMilli()
		w.ToMs = tomorrow.UnixMilli()
	case Range30Days:
		w.FromMs = today.AddDate(0, 0, -29).UnixMilli()
		w.ToMs = tomorrow.UnixMilli()
	case RangeMonth:
		start := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, loc)
		w.FromMs = start.UnixMilli()
		w.ToMs = start.AddDate(0, 1, 0).UnixMilli()
	case RangeYear:
		start := time.Date(local.Year(), time.January, 1, 0, 0, 0, 0, loc)
		w.FromMs = start.UnixMilli()
		w.ToMs = start.AddDate(1, 0, 0).UnixMilli()
	default:
		w.Unbounded = true
	}
	return w, nil
}

func YearWindow(year int, timezone string, now time.Time) (Window, error) {
	loc, err := LoadLocation(timezone)
	if err != nil {
		return Window{}, err
	}
	if year <= 0 {
		year = now.In(loc).Year()
	}
	if year < 1970 || year > 9999 {
		return Window{}, fmt.Errorf("invalid heatmap year %d", year)
	}
	start := time.Date(year, time.January, 1, 0, 0, 0, 0, loc)
	end := start.AddDate(1, 0, 0)
	return Window{Name: RangeYear, FromMs: start.UnixMilli(), ToMs: end.UnixMilli(), Loc: loc}, nil
}

func canonicalRange(name string) (string, error) {
	switch normalizeToken(name) {
	case "today":
		return RangeToday, nil
	case "7d", "7", "7 day", "7 days", "week", "this week":
		return Range7Days, nil
	case "30d", "30", "30 day", "30 days":
		return Range30Days, nil
	case "month", "this month":
		return RangeMonth, nil
	case "year", "this year":
		return RangeYear, nil
	case "all", "all time":
		return RangeAll, nil
	default:
		return "", fmt.Errorf("unknown listening range %q", name)
	}
}

func canonicalPeriod(kind string) (string, error) {
	switch normalizeToken(kind) {
	case "month", "monthly":
		return PeriodMonth, nil
	case "year", "yearly", "annual":
		return PeriodYear, nil
	default:
		return "", fmt.Errorf("unknown rewind period %q", kind)
	}
}

func normalizeToken(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.NewReplacer("_", " ", "-", " ").Replace(value)
	return strings.Join(strings.Fields(value), " ")
}

func LocalDay(ms int64, loc *time.Location) string {
	if loc == nil {
		loc = time.UTC
	}
	return time.UnixMilli(ms).In(loc).Format("2006-01-02")
}

func LocalHour(ms int64, loc *time.Location) int {
	if loc == nil {
		loc = time.UTC
	}
	return time.UnixMilli(ms).In(loc).Hour()
}

func (w Window) eachDay() []time.Time {
	if w.Unbounded || w.ToMs <= w.FromMs {
		return nil
	}
	loc := w.location()
	start := time.UnixMilli(w.FromMs).In(loc)
	end := time.UnixMilli(w.ToMs).In(loc)
	cur := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, loc)
	stop := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, loc)
	if end.After(stop) {
		stop = stop.AddDate(0, 0, 1)
	}
	days := make([]time.Time, 0, 32)
	for i := 0; i < 40000 && cur.Before(stop); i++ {
		days = append(days, cur)
		next := cur.AddDate(0, 0, 1)
		if !next.After(cur) {
			break
		}
		cur = next
	}
	return days
}
