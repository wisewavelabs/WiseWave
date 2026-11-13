import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addCalendarDays, formatDateLabel, formatListened, hourLabel, isoDate, parseIso, rangeBounds, zonedParts } from "./format";
import type { ListeningActivity, ListeningDay, ListeningHour, ListeningRange } from "./types";

function fillDays(days: ListeningDay[], range: ListeningRange, timeZone: string) {
  if (range === "all") return [...days].sort((a, b) => a.date.localeCompare(b.date));
  const now = new Date();
  const bounds = rangeBounds(range, timeZone, now);
  const start = zonedParts(new Date(bounds.fromMs), timeZone);
  const end = zonedParts(now, timeZone);
  const map = new Map(days.map((day) => [day.date, day]));
  const filled: ListeningDay[] = [];
  let cursor = { y: start.y, m: start.m, d: start.d };
  const endKey = isoDate(end.y, end.m, end.d);
  for (let index = 0; index < 400; index += 1) {
    const key = isoDate(cursor.y, cursor.m, cursor.d);
    filled.push(map.get(key) || { date: key, listened_ms: 0, plays: 0 });
    if (key === endKey) break;
    cursor = addCalendarDays(cursor.y, cursor.m, cursor.d, 1);
  }
  return filled;
}

function fillHours(hours: ListeningHour[]) {
  const map = new Map(hours.map((hour) => [hour.hour, hour]));
  return Array.from({ length: 24 }, (_, hour) => map.get(hour) || { hour, listened_ms: 0, plays: 0 });
}

function heatLevel(ms: number, max: number) {
  if (ms <= 0 || max <= 0) return 0;
  const ratio = ms / max;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}

function heatmapWeeks(year: number, cells: ListeningDay[]) {
  const byDate = new Map(cells.map((cell) => [cell.date, cell]));
  const start = new Date(Date.UTC(year, 0, 1));
  const cursor = new Date(start);
  cursor.setUTCDate(1 - start.getUTCDay());
  const weeks: { date: string; inYear: boolean; point: ListeningDay | null }[][] = [];
  while (weeks.length < 54) {
    const week: { date: string; inYear: boolean; point: ListeningDay | null }[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = cursor.toISOString().slice(0, 10);
      const inYear = cursor.getUTCFullYear() === year;
      week.push({ date, inYear, point: inYear ? byDate.get(date) || null : null });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
    if (cursor.getUTCFullYear() > year) break;
  }
  return weeks;
}

export function ActivityCharts({
  activity,
  cells,
  range,
  timezone,
  year,
  currentYear,
  heatmapStatus,
  onYear,
}: {
  activity: ListeningActivity;
  cells: ListeningDay[];
  range: ListeningRange;
  timezone: string;
  year: number;
  currentYear: number;
  heatmapStatus: "loading" | "ready" | "error";
  onYear: (year: number) => void;
}) {
  const days = useMemo(() => fillDays(activity.days, range, timezone), [activity.days, range, timezone]);
  const hours = useMemo(() => fillHours(activity.hours), [activity.hours]);
  const weeks = useMemo(() => heatmapWeeks(year, cells), [year, cells]);
  const dayMax = Math.max(1, ...days.map((day) => day.listened_ms));
  const hourMax = Math.max(1, ...hours.map((hour) => hour.listened_ms));
  const heatMax = Math.max(0, ...cells.map((cell) => cell.listened_ms));
  const frame = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; body: string } | null>(null);
  const totalMs = days.reduce((sum, day) => sum + day.listened_ms, 0);
  const showDayLabels = days.length > 0 && days.length <= 14;
  const months = weeks.map((week, index) => {
    const first = week.find((day) => day.inYear);
    const parsed = first ? parseIso(first.date) : null;
    if (!parsed || parsed.d > 7) return null;
    const label = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)));
    return { index, label };
  }).filter((item): item is { index: number; label: string } => item !== null);

  const placeTip = (target: HTMLElement, title: string, body: string) => {
    const bounds = frame.current?.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    if (!bounds) return;
    setTip({ x: box.left - bounds.left + box.width / 2, y: box.top - bounds.top, title, body });
  };

  return (
    <section className="listening-section" aria-labelledby="listening-activity" ref={frame}>
      <h2 id="listening-activity">Activity</h2>
      <p className="listening-sr">{formatListened(totalMs)} across {days.length} days in this period.</p>
      <div className="listening-chart-block">
        <h3>Daily listening</h3>
        {days.length ? (
          <div className="listening-bars player-scroll" role="list" aria-label="Daily listening time">
            {days.map((day) => (
              <button
                key={day.date}
                className="listening-bar"
                type="button"
                role="listitem"
                data-empty={day.listened_ms <= 0 || undefined}
                aria-label={`${formatDateLabel(day.date, timezone)}, ${formatListened(day.listened_ms)}, ${day.plays} played`}
                onMouseEnter={(event) => placeTip(event.currentTarget, formatDateLabel(day.date, timezone), `${formatListened(day.listened_ms)} · ${day.plays} played`)}
                onFocus={(event) => placeTip(event.currentTarget, formatDateLabel(day.date, timezone), `${formatListened(day.listened_ms)} · ${day.plays} played`)}
                onMouseLeave={() => setTip(null)}
                onBlur={() => setTip(null)}
              >
                <span style={{ height: `${Math.max(day.listened_ms > 0 ? 4 : 0, (day.listened_ms / dayMax) * 100)}%` }} />
                {showDayLabels ? <small>{day.date.slice(8)}</small> : null}
              </button>
            ))}
          </div>
        ) : <p className="listening-note">No daily activity in this period.</p>}
      </div>
      <div className="listening-chart-block">
        <div className="listening-chart-heading">
          <h3>Year</h3>
          <div className="listening-year">
            <button type="button" aria-label="Previous year" onClick={() => onYear(year - 1)}><ChevronLeft size={16} /></button>
            <span>{year}</span>
            <button type="button" aria-label="Next year" disabled={year >= currentYear} onClick={() => onYear(Math.min(currentYear, year + 1))}><ChevronRight size={16} /></button>
          </div>
        </div>
        {heatmapStatus === "loading" ? <p className="listening-note">Loading this year.</p> : null}
        {heatmapStatus === "error" ? <p className="listening-note">This year could not be loaded.</p> : null}
        {heatmapStatus === "ready" ? (
          <div className="listening-heatmap-scroll player-scroll">
            <div className="listening-months" aria-hidden="true" style={{ gridTemplateColumns: `16px repeat(${weeks.length}, 12px)` }}>
              {months.map((month) => <span key={`${month.label}-${month.index}`} style={{ gridColumn: month.index + 2 }}>{month.label}</span>)}
            </div>
            <div className="listening-heatmap" role="grid" aria-label={`Listening in ${year}`} style={{ gridTemplateColumns: `16px repeat(${weeks.length}, 12px)` }}>
              {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => <span key={`${label}-${index}`} className="listening-dow" style={{ gridRow: index + 1 }} aria-hidden="true">{label}</span>)}
              {weeks.map((week, weekIndex) => week.map((day, dayIndex) => day.inYear ? (
                <button
                  key={day.date}
                  type="button"
                  className="listening-heat"
                  role="gridcell"
                  data-level={heatLevel(day.point?.listened_ms || 0, heatMax)}
                  style={{ gridColumn: weekIndex + 2, gridRow: dayIndex + 1 }}
                  aria-label={`${formatDateLabel(day.date, timezone)}, ${formatListened(day.point?.listened_ms || 0)}, ${day.point?.plays || 0} played`}
                  onMouseEnter={(event) => placeTip(event.currentTarget, formatDateLabel(day.date, timezone), `${formatListened(day.point?.listened_ms || 0)} · ${day.point?.plays || 0} played`)}
                  onFocus={(event) => placeTip(event.currentTarget, formatDateLabel(day.date, timezone), `${formatListened(day.point?.listened_ms || 0)} · ${day.point?.plays || 0} played`)}
                  onMouseLeave={() => setTip(null)}
                  onBlur={() => setTip(null)}
                />
              ) : <span key={`${weekIndex}-${dayIndex}`} className="listening-heat is-outside" style={{ gridColumn: weekIndex + 2, gridRow: dayIndex + 1 }} />))}
            </div>
            <div className="listening-legend" aria-hidden="true"><span>Less</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} />)}<span>More</span></div>
          </div>
        ) : null}
        {tip ? <div className="listening-tooltip" style={{ left: tip.x, top: tip.y }} role="status"><strong>{tip.title}</strong><span>{tip.body}</span></div> : null}
      </div>
      <div className="listening-chart-block">
        <h3>Listening clock</h3>
        <ListeningClock hours={hours} max={hourMax} timezone={timezone} />
      </div>
    </section>
  );
}

function ListeningClock({ hours, max, timezone }: { hours: ListeningHour[]; max: number; timezone: string }) {
  const [active, setActive] = useState<number | null>(null);
  const peak = hours.reduce((best, hour) => hour.listened_ms > best.listened_ms ? hour : best, hours[0]);
  const hasTime = hours.some((hour) => hour.listened_ms > 0);
  return (
    <div className="listening-clock-wrap">
      <svg className="listening-clock" viewBox="0 0 280 280" role="img" aria-label={hasTime && peak ? `Most listening around ${hourLabel(peak.hour, timezone)}` : "No hourly listening in this period"}>
        <circle cx="140" cy="140" r="52" fill="none" stroke="#2a2a2a" strokeWidth="1" />
        {hours.map((hour) => {
          const angle = (hour.hour / 24) * Math.PI * 2 - Math.PI / 2;
          const length = hour.listened_ms > 0 ? 18 + (hour.listened_ms / max) * 68 : 8;
          const x2 = 140 + Math.cos(angle) * length;
          const y2 = 140 + Math.sin(angle) * length;
          const x1 = 140 + Math.cos(angle) * 56;
          const y1 = 140 + Math.sin(angle) * 56;
          return (
            <line
              key={hour.hour}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={hour.listened_ms > 0 ? "#fff" : "#2a2a2a"}
              strokeWidth={active === hour.hour ? 8 : 5}
              strokeLinecap="round"
              onMouseEnter={() => setActive(hour.hour)}
              onMouseLeave={() => setActive(null)}
            >
              <title>{`${hourLabel(hour.hour, timezone)} · ${formatListened(hour.listened_ms)} · ${hour.plays} played`}</title>
            </line>
          );
        })}
        {[0, 6, 12, 18].map((hour) => {
          const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
          const x = 140 + Math.cos(angle) * 118;
          const y = 140 + Math.sin(angle) * 118;
          return <text key={hour} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#a4a4a4" fontSize="11">{hourLabel(hour, timezone).replace(":00", "")}</text>;
        })}
      </svg>
      <p className="listening-note">
        {active != null ? `${hourLabel(active, timezone)} · ${formatListened(hours[active]?.listened_ms || 0)} · ${hours[active]?.plays || 0} played` : hasTime && peak ? `Most around ${hourLabel(peak.hour, timezone)}` : "No hourly listening in this period."}
      </p>
    </div>
  );
}
