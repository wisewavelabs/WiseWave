import { useCallback, useEffect, useMemo, useState } from "react";
import { HISTORY_PAGE, listening } from "./listeningClient";
import { listeningTimezone, parseIso, rangeBounds, yearInTimeZone, zonedTimeToUtc } from "./format";
import type {
  ListeningActivity,
  ListeningDay,
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

function mergePlays(current: ListeningPlay[], next: ListeningPlay[]) {
  const seen = new Set(current.map((item) => item.id > 0 ? `id:${item.id}` : `${item.track_id}:${item.started_at_ms}`));
  const extra = next.filter((item) => {
    const key = item.id > 0 ? `id:${item.id}` : `${item.track_id}:${item.started_at_ms}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...current, ...extra];
}

function historyHasMore(total: number, loaded: number, pageSize: number) {
  if (pageSize < HISTORY_PAGE) return false;
  if (total > loaded) return true;
  return total === 0 && pageSize === HISTORY_PAGE;
}

export function useListeningData() {
  const timezone = useMemo(listeningTimezone, []);
  const [range, setRange] = useState<ListeningRange>("30d");
  const [heatmapYear, setHeatmapYear] = useState(() => yearInTimeZone(listeningTimezone()));
  const [version, setVersion] = useState(0);
  const [coreStatus, setCoreStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<ListeningOverview | null>(null);
  const [activity, setActivity] = useState<ListeningActivity>({ days: [], hours: [] });
  const [tracks, setTracks] = useState<ListeningTopTrack[]>([]);
  const [artists, setArtists] = useState<ListeningTopArtist[]>([]);
  const [albums, setAlbums] = useState<ListeningTopAlbum[]>([]);
  const [insights, setInsights] = useState<ListeningInsight[]>([]);
  const [sessions, setSessions] = useState<ListeningSession[]>([]);
  const [heatmap, setHeatmap] = useState<ListeningDay[]>([]);
  const [heatmapStatus, setHeatmapStatus] = useState<"loading" | "ready" | "error">("loading");
  const [historyQuery, setHistoryQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [history, setHistory] = useState<ListeningPlay[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyStatus, setHistoryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [historyError, setHistoryError] = useState("");
  const [historyMore, setHistoryMore] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(historyQuery.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [historyQuery]);

  useEffect(() => {
    let alive = true;
    setCoreStatus("loading");
    setError("");
    Promise.all([
      listening.overview(range, timezone),
      listening.activity(range, timezone),
      listening.topTracks(range, timezone, 20, 0),
      listening.topArtists(range, timezone, 20, 0),
      listening.topAlbums(range, timezone, 20, 0),
      listening.insights(range, timezone),
      listening.sessions(range, timezone, 40, 0),
    ]).then(([nextOverview, nextActivity, nextTracks, nextArtists, nextAlbums, nextInsights, nextSessions]) => {
      if (!alive) return;
      setOverview(nextOverview);
      setActivity(nextActivity);
      setTracks(nextTracks);
      setArtists(nextArtists);
      setAlbums(nextAlbums);
      setInsights(nextInsights);
      setSessions(nextSessions);
      setCoreStatus("ready");
    }).catch((reason: unknown) => {
      if (!alive) return;
      setError(reason instanceof Error ? reason.message : "Your listening could not be loaded.");
      setCoreStatus("error");
    });
    return () => { alive = false; };
  }, [range, timezone, version]);

  useEffect(() => {
    let alive = true;
    setHeatmapStatus("loading");
    listening.heatmap(heatmapYear, timezone).then((days) => {
      if (!alive) return;
      setHeatmap(days);
      setHeatmapStatus("ready");
    }).catch(() => {
      if (!alive) return;
      setHeatmapStatus("error");
    });
    return () => { alive = false; };
  }, [heatmapYear, timezone, version]);

  const windowMs = useMemo(() => {
    const bounds = rangeBounds(range, timezone);
    let fromMs = bounds.fromMs;
    let toMs = bounds.toMs;
    const from = parseIso(historyFrom);
    const to = parseIso(historyTo);
    if (from) fromMs = Math.max(fromMs, zonedTimeToUtc(from.y, from.m, from.d, 0, 0, 0, timezone));
    if (to) toMs = Math.min(toMs, zonedTimeToUtc(to.y, to.m, to.d, 23, 59, 59, timezone));
    return { fromMs, toMs };
  }, [range, timezone, historyFrom, historyTo]);

  useEffect(() => {
    let alive = true;
    setHistoryStatus("loading");
    setHistoryError("");
    listening.history(debouncedQuery, windowMs.fromMs, windowMs.toMs, timezone, HISTORY_PAGE, 0).then((page) => {
      if (!alive) return;
      setHistory(page.items);
      setHistoryTotal(page.total);
      setHistoryMore(historyHasMore(page.total, page.items.length, page.items.length));
      setHistoryStatus("ready");
    }).catch((reason: unknown) => {
      if (!alive) return;
      setHistory([]);
      setHistoryMore(false);
      setHistoryError(reason instanceof Error ? reason.message : "Your listening could not be loaded.");
      setHistoryStatus("error");
    });
    return () => { alive = false; };
  }, [debouncedQuery, windowMs.fromMs, windowMs.toMs, timezone, version]);

  const loadMoreHistory = useCallback(() => {
    if (!historyMore || historyStatus === "loading") return;
    const offset = history.length;
    setHistoryStatus("loading");
    listening.history(debouncedQuery, windowMs.fromMs, windowMs.toMs, timezone, HISTORY_PAGE, offset).then((page) => {
      setHistory((current) => mergePlays(current, page.items));
      setHistoryMore(historyHasMore(page.total, offset + page.items.length, page.items.length));
      setHistoryTotal(page.total || offset + page.items.length);
      setHistoryStatus("ready");
    }).catch((reason: unknown) => {
      setHistoryError(reason instanceof Error ? reason.message : "Your listening could not be loaded.");
      setHistoryStatus("error");
    });
  }, [historyMore, historyStatus, history.length, debouncedQuery, windowMs.fromMs, windowMs.toMs, timezone]);

  const changeRange = useCallback((next: ListeningRange) => {
    setRange(next);
    setHistoryFrom("");
    setHistoryTo("");
  }, []);

  const empty = coreStatus === "ready"
    && historyStatus === "ready"
    && !debouncedQuery
    && !historyFrom
    && !historyTo
    && (overview?.listened_ms || 0) <= 0
    && (overview?.plays || 0) <= 0
    && tracks.length === 0
    && artists.length === 0
    && albums.length === 0
    && sessions.length === 0
    && insights.length === 0
    && history.length === 0;

  const loading = coreStatus === "loading" || (historyStatus === "loading" && history.length === 0 && !historyQuery && !historyFrom && !historyTo);

  return {
    timezone,
    range,
    setRange: changeRange,
    heatmapYear,
    setHeatmapYear,
    currentYear: yearInTimeZone(timezone),
    status: coreStatus === "error" ? "error" as const : loading ? "loading" as const : "ready" as const,
    error,
    reload: () => setVersion((value) => value + 1),
    empty,
    overview,
    activity,
    tracks,
    artists,
    albums,
    insights,
    sessions,
    heatmap,
    heatmapStatus,
    historyQuery,
    setHistoryQuery,
    historyFrom,
    setHistoryFrom,
    historyTo,
    setHistoryTo,
    history,
    historyTotal,
    historyStatus,
    historyError,
    historyMore,
    loadMoreHistory,
  };
}

export const CAPSULE_LIVE_MIN_TRACKS = 5;
const LISTENING_UPDATED = "wisewave-listening-updated";

function emptyRewind(kind: RewindKind, year: number, month: number): ListeningRewind {
  return {
    kind, label: "", year, month, listened_ms: 0, plays: 0, tracks: 0, artists: 0, albums: 0,
    top_tracks: [], top_artists: [], top_albums: [], discoveries: [], milestones: [], records: [], changes: [],
  };
}

export function useRewind(kind: RewindKind, year: number, month: number) {
  const timezone = useMemo(listeningTimezone, []);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [recap, setRecap] = useState<ListeningRewind | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const onUpdate = () => setVersion((value) => value + 1);
    window.addEventListener(LISTENING_UPDATED, onUpdate);
    return () => window.removeEventListener(LISTENING_UPDATED, onUpdate);
  }, []);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setError("");
    Promise.all([
      listening.topTracks("all", timezone, 100, 0),
      listening.rewind(kind, year, month, timezone),
    ]).then(([lifetime, value]) => {
      if (!alive) return;
      const unlocked = lifetime.filter((item) => item.plays > 0).length >= CAPSULE_LIVE_MIN_TRACKS;
      setLive(unlocked);
      setRecap(unlocked ? value : emptyRewind(kind, year, month));
      setStatus("ready");
    }).catch((reason: unknown) => {
      if (!alive) return;
      setError(reason instanceof Error ? reason.message : "Your listening could not be loaded.");
      setStatus("error");
    });
    return () => { alive = false; };
  }, [kind, year, month, timezone, version]);

  const empty = status === "ready" && !!recap && (!live
    || (recap.listened_ms <= 0 && recap.plays <= 0 && recap.tracks <= 0
      && recap.top_tracks.length === 0 && recap.top_artists.length === 0 && recap.top_albums.length === 0
      && recap.discoveries.length === 0 && recap.milestones.length === 0 && recap.records.length === 0 && recap.changes.length === 0));

  return { timezone, status, error, recap, empty, live, reload: () => setVersion((value) => value + 1) };
}
