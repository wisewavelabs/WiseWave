import { compareListening, countLabel, formatDateLabel, formatListened, hourLabel } from "./format";
import type { ListeningOverview, ListeningRange } from "./types";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="listening-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

export function OverviewStats({ overview, range, timezone }: { overview: ListeningOverview; range: ListeningRange; timezone: string }) {
  const activeDay = overview.most_active_day
    ? formatDateLabel(overview.most_active_day, timezone)
    : "—";
  const activeHour = overview.most_active_hour >= 0 && (overview.most_active_hour_ms > 0 || (overview.listened_ms > 0 && overview.most_active_day !== ""))
    ? hourLabel(overview.most_active_hour, timezone)
    : "—";
  return (
    <section className="listening-section" aria-labelledby="listening-overview">
      <h2 id="listening-overview">Overview</h2>
      <dl className="listening-stats">
        <Stat label="Listening time" value={formatListened(overview.listened_ms)} note={compareListening(overview.listened_ms, overview.previous_listened_ms, range)} />
        <Stat label="Tracks played" value={countLabel(overview.plays, "play")} />
        <Stat label="Unique songs" value={String(overview.tracks)} />
        <Stat label="Artists" value={String(overview.artists)} />
        <Stat label="Albums" value={String(overview.albums)} />
        <Stat label="Daily average" value={formatListened(overview.average_daily_ms)} />
        <Stat label="Longest session" value={overview.longest_session_ms > 0 ? formatListened(overview.longest_session_ms) : "—"} />
        <Stat label="Current streak" value={countLabel(overview.current_streak, "day")} />
        <Stat label="Longest streak" value={countLabel(overview.longest_streak, "day")} />
        <Stat label="Most active day" value={activeDay} note={overview.most_active_day_ms > 0 ? formatListened(overview.most_active_day_ms) : undefined} />
        <Stat label="Most active hour" value={activeHour} note={overview.most_active_hour_ms > 0 ? formatListened(overview.most_active_hour_ms) : undefined} />
      </dl>
    </section>
  );
}
