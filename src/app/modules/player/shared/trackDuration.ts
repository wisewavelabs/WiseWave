import type { Track } from "../../../mygo";

export function trackDurationSeconds(track: Pick<Track, "duration" | "duration_seconds"> | null | undefined): number {
  if (!track) return 0;
  if (typeof track.duration_seconds === "number" && track.duration_seconds > 0) return Math.floor(track.duration_seconds);
  if (!track.duration || typeof track.duration !== "string") return 0;
  const parts = track.duration.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 2) return Math.max(0, (parts[0] || 0) * 60 + (parts[1] || 0));
  if (parts.length === 3) return Math.max(0, (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0));
  return 0;
}

export function formatDurationSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (!total) return "";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

export function trackDurationLabel(track: Pick<Track, "duration" | "duration_seconds"> | null | undefined, empty = "—"): string {
  const formatted = formatDurationSeconds(trackDurationSeconds(track));
  if (formatted) return formatted;
  if (track?.duration && typeof track.duration === "string" && track.duration.trim()) return track.duration.trim();
  return empty;
}

export function withTrackDuration<T extends Pick<Track, "duration" | "duration_seconds">>(track: T, seconds: number): T {
  const total = Math.max(0, Math.floor(seconds));
  if (!total) return track;
  return { ...track, duration_seconds: total, duration: formatDurationSeconds(total) };
}
