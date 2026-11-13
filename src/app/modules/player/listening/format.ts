import type { Track } from "../../../mygo";
import type { ListeningPlay, ListeningRange, ListeningTopTrack } from "./types";

export function listeningTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function zonedParts(date: Date, timeZone: string) {
  const map: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    h: Number(map.hour) % 24,
    min: Number(map.minute),
    s: Number(map.second),
  };
}

export function zoneOffsetMs(utcMs: number, timeZone: string) {
  const parts = zonedParts(new Date(utcMs), timeZone);
  return Date.UTC(parts.y, parts.m - 1, parts.d, parts.h, parts.min, parts.s) - utcMs;
}

export function zonedTimeToUtc(y: number, m: number, d: number, h: number, min: number, s: number, timeZone: string) {
  const guess = Date.UTC(y, m - 1, d, h, min, s);
  const adjusted = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(adjusted, timeZone);
}

export function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function addCalendarDays(y: number, m: number, d: number, days: number) {
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
}

export function yearInTimeZone(timeZone: string, now = new Date()) {
  return zonedParts(now, timeZone).y;
}

export function dayKey(ms: number, timeZone: string) {
  const parts = zonedParts(new Date(ms), timeZone);
  return isoDate(parts.y, parts.m, parts.d);
}

export function rangeBounds(range: ListeningRange, timeZone: string, now = new Date()) {
  const toMs = now.getTime();
  if (range === "all") return { fromMs: 0, toMs };
  const parts = zonedParts(now, timeZone);
  if (range === "today") return { fromMs: zonedTimeToUtc(parts.y, parts.m, parts.d, 0, 0, 0, timeZone), toMs };
  if (range === "7d") {
    const start = addCalendarDays(parts.y, parts.m, parts.d, -6);
    return { fromMs: zonedTimeToUtc(start.y, start.m, start.d, 0, 0, 0, timeZone), toMs };
  }
  if (range === "30d") {
    const start = addCalendarDays(parts.y, parts.m, parts.d, -29);
    return { fromMs: zonedTimeToUtc(start.y, start.m, start.d, 0, 0, 0, timeZone), toMs };
  }
  if (range === "month") return { fromMs: zonedTimeToUtc(parts.y, parts.m, 1, 0, 0, 0, timeZone), toMs };
  return { fromMs: zonedTimeToUtc(parts.y, 1, 1, 0, 0, 0, timeZone), toMs };
}

export function formatListened(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

export function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatWhen(ms: number, timeZone: string, options: Intl.DateTimeFormatOptions) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Intl.DateTimeFormat(undefined, { timeZone, ...options }).format(new Date(ms));
}

export function formatDateLabel(date: string, timeZone: string) {
  const parsed = parseIso(date);
  if (!parsed) return date;
  const ms = zonedTimeToUtc(parsed.y, parsed.m, parsed.d, 12, 0, 0, timeZone);
  return new Intl.DateTimeFormat(undefined, { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(ms));
}

export function formatHistoryDay(ms: number, timeZone: string, now = new Date()) {
  const key = dayKey(ms, timeZone);
  const today = dayKey(now.getTime(), timeZone);
  const parts = zonedParts(now, timeZone);
  const yesterday = addCalendarDays(parts.y, parts.m, parts.d, -1);
  if (key === today) return "Today";
  if (key === isoDate(yesterday.y, yesterday.m, yesterday.d)) return "Yesterday";
  return formatDateLabel(key, timeZone);
}

export function hourLabel(hour: number, timeZone: string) {
  const ms = zonedTimeToUtc(2026, 1, 5, hour, 0, 0, timeZone);
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric" }).format(new Date(ms));
}

export function compareListening(current: number, previous: number | undefined, range: ListeningRange) {
  if (range === "all" || previous == null || !Number.isFinite(previous)) return "";
  if (previous <= 0 && current <= 0) return "Same as the previous period";
  if (previous <= 0) return "Nothing in the previous period";
  const pct = Math.round((Math.abs(current - previous) / previous) * 100);
  if (pct === 0) return "About the same as the previous period";
  return current > previous ? `${pct}% more than the previous period` : `${pct}% less than the previous period`;
}

export function trackFromListening(item: Pick<ListeningTopTrack, "track_id" | "title" | "artist" | "artist_id" | "album" | "album_id" | "artwork_url" | "track_duration_ms">): Track {
  const seconds = Math.max(0, Math.round((item.track_duration_ms || 0) / 1000));
  return {
    id: item.track_id,
    title: item.title,
    artist: item.artist,
    artist_id: item.artist_id,
    album: item.album,
    album_id: item.album_id,
    duration: seconds ? formatClock(seconds) : "",
    duration_seconds: seconds,
    album_art_url: item.artwork_url,
    stream_url: "",
    is_favorite: false,
  };
}

export function trackFromPlay(item: ListeningPlay): Track {
  return trackFromListening(item);
}

export function shiftMonth(year: number, month: number, delta: number) {
  const utc = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1 };
}

export function periodLabel(kind: "month" | "year", year: number, month: number, timeZone: string) {
  if (kind === "year") return String(year);
  const ms = zonedTimeToUtc(year, month, 1, 12, 0, 0, timeZone);
  return new Intl.DateTimeFormat(undefined, { timeZone, month: "long", year: "numeric" }).format(new Date(ms));
}
