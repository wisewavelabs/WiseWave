import { call } from "mygo-runtime";
import { Listening, type Heartbeat } from "../../../mygo";
export type PlayHeartbeat = Heartbeat;
import type {
  ListeningActivity,
  ListeningDay,
  ListeningHistoryPage,
  ListeningHour,
  ListeningInsight,
  ListeningOverview,
  ListeningPlay,
  ListeningRange,
  ListeningRewind,
  ListeningSession,
  ListeningTopAlbum,
  ListeningTopArtist,
  ListeningTopTrack,
  RewindKind,
} from "./types";

const MISSING_BIND = /runtime not found|not bound|unknown method|no binding|unregistered|method not found|no such method|does not exist/i;
export const HISTORY_PAGE = 40;
export const TOP_PAGE = 20;

const emptyOverview: ListeningOverview = {
  listened_ms: 0,
  plays: 0,
  tracks: 0,
  artists: 0,
  albums: 0,
  average_daily_ms: 0,
  longest_session_ms: 0,
  current_streak: 0,
  longest_streak: 0,
  most_active_day: "",
  most_active_day_ms: 0,
  most_active_hour: -1,
  most_active_hour_ms: 0,
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pick(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (record[key] != null && record[key] !== "") return record[key];
  }
  return undefined;
}

function num(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown) {
  return typeof value === "string" ? value : "";
}

function flag(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function arrayField(value: unknown, keys: string[]) {
  if (Array.isArray(value)) return value;
  const record = rec(value);
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function optionalNum(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (key in record && record[key] != null) return num(record[key]);
  }
  return undefined;
}

async function invoke<T>(name: string, args: unknown[], normalize: (value: unknown) => T, empty: T): Promise<T> {
  try {
    return normalize(await call<unknown>(`Listening.${name}`, ...args));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (MISSING_BIND.test(message)) return empty;
    throw new Error("Your listening could not be loaded.");
  }
}

function normalizeDay(value: unknown): ListeningDay | null {
  const record = rec(value);
  const date = str(pick(record, ["date", "day", "day_key"]));
  if (!date) return null;
  return {
    date,
    listened_ms: num(pick(record, ["listened_ms", "listenedMs", "ms"])),
    plays: num(pick(record, ["plays", "play_count", "tracks"])),
  };
}

function normalizeHour(value: unknown): ListeningHour | null {
  const record = rec(value);
  if (!("hour" in record) && !("h" in record)) return null;
  return {
    hour: num(pick(record, ["hour", "h"])),
    listened_ms: num(pick(record, ["listened_ms", "listenedMs", "ms"])),
    plays: num(pick(record, ["plays", "play_count", "tracks"])),
  };
}

function normalizeOverview(value: unknown): ListeningOverview {
  const record = rec(value);
  const hour = optionalNum(record, ["most_active_hour", "peak_hour"]);
  return {
    listened_ms: num(pick(record, ["listened_ms", "total_ms", "listening_ms"])),
    plays: num(pick(record, ["plays", "play_count", "tracks_played"])),
    tracks: num(pick(record, ["tracks", "unique_tracks", "songs"])),
    artists: num(pick(record, ["artists", "unique_artists"])),
    albums: num(pick(record, ["albums", "unique_albums"])),
    average_daily_ms: num(pick(record, ["average_daily_ms", "avg_daily_ms", "avg_listened_ms"])),
    longest_session_ms: num(pick(record, ["longest_session_ms"])),
    current_streak: num(pick(record, ["current_streak", "streak"])),
    longest_streak: num(pick(record, ["longest_streak"])),
    most_active_day: str(pick(record, ["most_active_day", "peak_day"])),
    most_active_day_ms: num(pick(record, ["most_active_day_ms", "peak_day_ms"])),
    most_active_hour: hour == null ? -1 : hour,
    most_active_hour_ms: num(pick(record, ["most_active_hour_ms", "peak_hour_ms"])),
    previous_listened_ms: optionalNum(record, ["previous_listened_ms", "previous_ms"]),
  };
}

function normalizeActivity(value: unknown): ListeningActivity {
  const record = rec(value);
  const days = arrayField(Array.isArray(value) ? value : record, ["days", "daily", "points"]).map(normalizeDay).filter((item): item is ListeningDay => item !== null);
  const hours = arrayField(record, ["hours", "hourly"]).map(normalizeHour).filter((item): item is ListeningHour => item !== null);
  return { days, hours };
}

function normalizeDays(value: unknown) {
  return arrayField(value, ["cells", "days", "heatmap"]).map(normalizeDay).filter((item): item is ListeningDay => item !== null);
}

function normalizeTopTrack(value: unknown): ListeningTopTrack | null {
  const record = rec(value);
  const trackId = str(pick(record, ["track_id", "id"]));
  const title = str(pick(record, ["title", "name"]));
  if (!trackId && !title) return null;
  return {
    track_id: trackId,
    title,
    artist: str(pick(record, ["artist", "artist_name"])),
    artist_id: str(pick(record, ["artist_id"])),
    album: str(pick(record, ["album", "album_title"])),
    album_id: str(pick(record, ["album_id"])),
    artwork_url: str(pick(record, ["artwork_url", "album_art_url", "thumbnail"])),
    listened_ms: num(pick(record, ["listened_ms", "ms"])),
    plays: num(pick(record, ["plays", "play_count"])),
    last_played_ms: num(pick(record, ["last_played_ms", "last_played", "last_played_at_ms", "ended_at_ms"])),
    track_duration_ms: num(pick(record, ["track_duration_ms", "duration_ms"])),
  };
}

function normalizeTopArtist(value: unknown): ListeningTopArtist | null {
  const record = rec(value);
  const name = str(pick(record, ["name", "artist", "title"]));
  const artistId = str(pick(record, ["artist_id", "id"]));
  if (!name && !artistId) return null;
  return {
    artist_id: artistId,
    name,
    artwork_url: str(pick(record, ["artwork_url", "thumbnail"])),
    listened_ms: num(pick(record, ["listened_ms", "ms"])),
    plays: num(pick(record, ["plays", "play_count"])),
    tracks: num(pick(record, ["tracks", "unique_tracks", "unique_songs", "songs"])),
  };
}

function normalizeTopAlbum(value: unknown): ListeningTopAlbum | null {
  const record = rec(value);
  const title = str(pick(record, ["title", "album", "name"]));
  const albumId = str(pick(record, ["album_id", "id"]));
  if (!title && !albumId) return null;
  return {
    album_id: albumId,
    title,
    artist: str(pick(record, ["artist", "artist_name"])),
    artist_id: str(pick(record, ["artist_id"])),
    artwork_url: str(pick(record, ["artwork_url", "thumbnail"])),
    listened_ms: num(pick(record, ["listened_ms", "ms"])),
    plays: num(pick(record, ["plays", "play_count"])),
    tracks: num(pick(record, ["tracks", "track_count"])),
  };
}

export function normalizePlay(value: unknown): ListeningPlay | null {
  const record = rec(value);
  const trackId = str(pick(record, ["track_id", "id"]));
  const title = str(pick(record, ["title", "name"]));
  const started = num(pick(record, ["started_at_ms", "started", "played_at_ms"]));
  if (!trackId && !title && started <= 0) return null;
  return {
    id: num(pick(record, ["id", "play_id"])),
    track_id: trackId && trackId !== title ? trackId : str(pick(record, ["track_id"])),
    title,
    artist: str(pick(record, ["artist"])),
    artist_id: str(pick(record, ["artist_id"])),
    album: str(pick(record, ["album"])),
    album_id: str(pick(record, ["album_id"])),
    artwork_url: str(pick(record, ["artwork_url", "album_art_url"])),
    started_at_ms: started,
    ended_at_ms: num(pick(record, ["ended_at_ms", "ended"])),
    listened_ms: num(pick(record, ["listened_ms", "ms"])),
    track_duration_ms: num(pick(record, ["track_duration_ms", "duration_ms"])),
    qualified: flag(pick(record, ["qualified"])),
    completed: flag(pick(record, ["completed"])),
    session_id: str(pick(record, ["session_id"])),
  };
}

function normalizeHistory(value: unknown): ListeningHistoryPage {
  if (Array.isArray(value)) {
    const items = value.map(normalizePlay).filter((item): item is ListeningPlay => item !== null);
    return { items, total: items.length < HISTORY_PAGE ? items.length : 0 };
  }
  const record = rec(value);
  const items = arrayField(record, ["items", "plays", "history", "entries"]).map(normalizePlay).filter((item): item is ListeningPlay => item !== null);
  const total = "total" in record || "count" in record ? num(pick(record, ["total", "count"])) : items.length;
  return { items, total };
}

function normalizeSession(value: unknown, fallbackId = ""): ListeningSession | null {
  if (Array.isArray(value)) {
    const tracks = value.map(normalizePlay).filter((item): item is ListeningPlay => item !== null);
    if (!tracks.length && !fallbackId) return null;
    let started = 0;
    let ended = 0;
    let listened = 0;
    const artists = new Map<string, { name: string; id: string; ms: number }>();
    for (const play of tracks) {
      if (play.started_at_ms > 0 && (started === 0 || play.started_at_ms < started)) started = play.started_at_ms;
      if (play.ended_at_ms > ended) ended = play.ended_at_ms;
      listened += play.listened_ms;
      if (!play.artist) continue;
      const key = play.artist_id || play.artist;
      const current = artists.get(key) || { name: play.artist, id: play.artist_id, ms: 0 };
      current.ms += play.listened_ms;
      artists.set(key, current);
    }
    let topArtist = "";
    let topArtistId = "";
    let topMs = -1;
    for (const artist of artists.values()) {
      if (artist.ms > topMs) {
        topArtist = artist.name;
        topArtistId = artist.id;
        topMs = artist.ms;
      }
    }
    return {
      id: fallbackId || tracks[0]?.session_id || "",
      started_at_ms: started,
      ended_at_ms: ended,
      listened_ms: listened,
      plays: tracks.length,
      top_artist: topArtist,
      top_artist_id: topArtistId,
      tracks,
    };
  }
  const record = rec(value);
  const nested = rec(record.session);
  const source = Object.keys(nested).length ? { ...nested, ...record } : record;
  const id = str(pick(source, ["id", "session_id"])) || fallbackId;
  const started = num(pick(source, ["started_at_ms", "started"]));
  const tracks = arrayField(record, ["tracks", "plays", "items", "history"]).map(normalizePlay).filter((item): item is ListeningPlay => item !== null);
  if (!id && started <= 0 && !tracks.length) return null;
  return {
    id,
    started_at_ms: started,
    ended_at_ms: num(pick(source, ["ended_at_ms", "ended"])),
    listened_ms: num(pick(source, ["listened_ms", "ms"])),
    plays: num(pick(source, ["plays", "play_count", "track_count", "tracks"])) || tracks.length,
    top_artist: str(pick(source, ["top_artist", "artist"])),
    top_artist_id: str(pick(source, ["top_artist_id", "artist_id"])),
    tracks,
  };
}

function stringList(value: unknown) {
  return (Array.isArray(value) ? value : []).map((item) => typeof item === "string" ? item : str(pick(rec(item), ["detail", "text", "title"]))).filter(Boolean);
}

function normalizeInsight(value: unknown): ListeningInsight | null {
  const record = rec(value);
  const title = str(pick(record, ["title", "headline", "label"]));
  const detail = str(pick(record, ["detail", "body", "text", "description"]));
  const trackTitle = str(pick(record, ["track_title", "title_name", "song"]));
  if (!title && !detail && !trackTitle) return null;
  return {
    kind: str(pick(record, ["kind", "type"])),
    title: title || trackTitle,
    detail,
    track_id: str(pick(record, ["track_id"])),
    title_name: trackTitle,
    artist: str(pick(record, ["artist"])),
    artist_id: str(pick(record, ["artist_id"])),
    artwork_url: str(pick(record, ["artwork_url"])),
    listened_ms: num(pick(record, ["listened_ms"])),
    plays: num(pick(record, ["plays", "play_count"])),
  };
}

function insightCards(value: unknown): ListeningInsight[] {
  if (Array.isArray(value)) return value.map(normalizeInsight).filter((item): item is ListeningInsight => item !== null);
  const record = rec(value);
  const nested = arrayField(record, ["items", "insights"]).map(normalizeInsight).filter((item): item is ListeningInsight => item !== null);
  if (nested.length || Array.isArray(record.insights) || Array.isArray(record.items)) return nested;
  const cards: ListeningInsight[] = [];
  for (const track of arrayField(record.on_repeat, ["items", "tracks"]).map(normalizeTopTrack).filter((item): item is ListeningTopTrack => item !== null)) {
    cards.push({ kind: "on_repeat", title: track.title, detail: track.artist, track_id: track.track_id, title_name: track.title, artist: track.artist, artist_id: track.artist_id, artwork_url: track.artwork_url, listened_ms: track.listened_ms, plays: track.plays });
  }
  if (flag(record.night_owl)) cards.push({ kind: "night_owl", title: "Night owl", detail: "", track_id: "", title_name: "", artist: "", artist_id: "", artwork_url: "", listened_ms: 0, plays: 0 });
  if (flag(record.early_bird)) cards.push({ kind: "early_bird", title: "Early bird", detail: "", track_id: "", title_name: "", artist: "", artist_id: "", artwork_url: "", listened_ms: 0, plays: 0 });
  for (const artist of arrayField(record.discoveries, ["items", "artists"]).map(normalizeTopArtist).filter((item): item is ListeningTopArtist => item !== null)) {
    cards.push({ kind: "discoveries", title: artist.name, detail: "", track_id: "", title_name: "", artist: artist.name, artist_id: artist.artist_id, artwork_url: artist.artwork_url, listened_ms: artist.listened_ms, plays: artist.plays });
  }
  for (const track of arrayField(record.old_favorites, ["items", "tracks"]).map(normalizeTopTrack).filter((item): item is ListeningTopTrack => item !== null)) {
    cards.push({ kind: "old_favorites", title: track.title, detail: track.artist, track_id: track.track_id, title_name: track.title, artist: track.artist, artist_id: track.artist_id, artwork_url: track.artwork_url, listened_ms: track.listened_ms, plays: track.plays });
  }
  const streak = num(record.current_streak);
  if (streak > 0) cards.push({ kind: "streak", title: "Listening streak", detail: `${streak} day${streak === 1 ? "" : "s"}`, track_id: "", title_name: "", artist: "", artist_id: "", artwork_url: "", listened_ms: 0, plays: 0 });
  for (const text of stringList(record.milestones)) {
    cards.push({ kind: "milestone", title: "Milestone", detail: text, track_id: "", title_name: "", artist: "", artist_id: "", artwork_url: "", listened_ms: 0, plays: 0 });
  }
  return cards;
}

function normalizeRewind(value: unknown): ListeningRewind {
  const record = rec(value);
  const explicitPlays = optionalNum(record, ["plays", "play_count"]);
  const uniqueTracks = optionalNum(record, ["unique_tracks"]);
  const tracksField = optionalNum(record, ["tracks"]);
  return {
    kind: str(pick(record, ["kind", "period"])),
    label: str(pick(record, ["label", "title"])),
    year: num(pick(record, ["year"])),
    month: num(pick(record, ["month"])),
    listened_ms: num(pick(record, ["listened_ms", "total_ms"])),
    plays: explicitPlays ?? tracksField ?? 0,
    tracks: uniqueTracks ?? (explicitPlays != null ? tracksField ?? 0 : 0),
    artists: num(pick(record, ["artists", "unique_artists"])),
    albums: num(pick(record, ["albums", "unique_albums"])),
    top_tracks: arrayField(record.top_tracks ?? record.tracks_top, ["items"]).map(normalizeTopTrack).filter((item): item is ListeningTopTrack => item !== null),
    top_artists: arrayField(record.top_artists ?? record.artists_top, ["items"]).map(normalizeTopArtist).filter((item): item is ListeningTopArtist => item !== null),
    top_albums: arrayField(record.top_albums ?? record.albums_top, ["items"]).map(normalizeTopAlbum).filter((item): item is ListeningTopAlbum => item !== null),
    discoveries: arrayField(record.discoveries, ["items", "artists"]).map(normalizeTopArtist).filter((item): item is ListeningTopArtist => item !== null),
    milestones: stringList(record.milestones ?? record.changes ?? record.notes),
    records: insightCards(record.insights ?? record.records),
    changes: stringList(record.changes ?? record.milestones ?? record.notes),
  };
}

function normalizeTops<T>(value: unknown, map: (item: unknown) => T | null) {
  return arrayField(value, ["items", "tracks", "artists", "albums"]).map(map).filter((item): item is T => item !== null);
}

export { getListeningTimeZone } from "./recordListening";

export function toPlayHeartbeat(
  track: { id: string; title: string; artist: string; artist_id?: string; album?: string; album_id?: string; album_art_url?: string },
  listenedMs: number,
  trackDurationMs: number,
  startedAtMs: number,
  attemptId = "",
): Heartbeat {
  return {
    attempt_id: attemptId || "",
    track_id: track.id,
    title: track.title || "",
    artist: track.artist || "",
    artist_id: track.artist_id || "",
    album: track.album || "",
    album_id: track.album_id || "",
    artwork_url: track.album_art_url || "",
    listened_ms: Math.max(0, Math.round(listenedMs)),
    track_duration_ms: Math.max(0, Math.round(trackDurationMs)),
    started_at_ms: startedAtMs > 0 ? Math.round(startedAtMs) : 0,
    private: false,
  };
}

export async function heartbeatPlay(payload: Heartbeat): Promise<void> {
  try { await Listening.heartbeat(payload); }
  catch {}
}

export async function finalizePlay(): Promise<void> {
  try { await Listening.finalize(); }
  catch {}
}

export async function discardPlay(): Promise<void> {
  try { await Listening.discard(); }
  catch {}
}

export async function setPrivateListening(on: boolean): Promise<void> {
  try { await Listening.setPrivate(on); }
  catch {}
}

export const listening = {
  overview(range: ListeningRange, timezone: string) {
    return invoke("Overview", [range, timezone], normalizeOverview, emptyOverview);
  },
  activity(range: ListeningRange, timezone: string) {
    return invoke("Activity", [range, timezone], normalizeActivity, { days: [], hours: [] });
  },
  heatmap(year: number, timezone: string) {
    return invoke("Heatmap", [year, timezone], normalizeDays, []);
  },
  topTracks(range: ListeningRange, timezone: string, limit = TOP_PAGE, offset = 0) {
    return invoke("TopTracks", [range, timezone, limit, offset], (value) => normalizeTops(value, normalizeTopTrack), []);
  },
  topArtists(range: ListeningRange, timezone: string, limit = TOP_PAGE, offset = 0) {
    return invoke("TopArtists", [range, timezone, limit, offset], (value) => normalizeTops(value, normalizeTopArtist), []);
  },
  topAlbums(range: ListeningRange, timezone: string, limit = TOP_PAGE, offset = 0) {
    return invoke("TopAlbums", [range, timezone, limit, offset], (value) => normalizeTops(value, normalizeTopAlbum), []);
  },
  history(query: string, fromMs: number, toMs: number, timezone: string, limit = HISTORY_PAGE, offset = 0) {
    return invoke("History", [query, fromMs, toMs, timezone, limit, offset], normalizeHistory, { items: [], total: 0 });
  },
  sessions(range: ListeningRange, timezone: string, limit = 30, offset = 0) {
    return invoke("Sessions", [range, timezone, limit, offset], (value) => arrayField(value, ["sessions", "items"]).map((item) => normalizeSession(item)).filter((item): item is ListeningSession => item !== null), []);
  },
  session(id: string) {
    return invoke("Session", [id], (value) => normalizeSession(value, id), null);
  },
  insights(range: ListeningRange, timezone: string) {
    return invoke("Insights", [range, timezone], insightCards, []);
  },
  rewind(kind: RewindKind, year: number, month: number, timezone: string) {
    const empty: ListeningRewind = {
      kind, label: "", year, month, listened_ms: 0, plays: 0, tracks: 0, artists: 0, albums: 0,
      top_tracks: [], top_artists: [], top_albums: [], discoveries: [], milestones: [], records: [], changes: [],
    };
    return invoke("Rewind", [kind, year, month, timezone], (value) => {
      const recap = normalizeRewind(value);
      return {
        ...recap,
        kind: recap.kind || kind,
        year: recap.year || year,
        month: recap.month || month,
      };
    }, empty);
  },
};
