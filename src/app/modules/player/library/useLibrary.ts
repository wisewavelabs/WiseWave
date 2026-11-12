import { useEffect, useRef, useState } from "react";
import { Music, type Track } from "../../../mygo";
import { formatDurationSeconds, trackDurationSeconds, withTrackDuration } from "../shared/trackDuration";

export type LibraryTrack = Track & { addedAt?: string };
export type Playlist = { id: string; name: string; description: string; cover?: string; tracks: LibraryTrack[] };
type Data = { liked: LibraryTrack[]; playlists: Playlist[] };
const key = "wisewave-library";

function durationSeconds(track: Track): number {
  return trackDurationSeconds(track);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function matchingDuration(track: Track, results: Track[]): Track | undefined {
  const title = normalize(track.title);
  const artist = normalize(track.artist);
  if (!title || !artist) return results.find((result) => result.id === track.id && durationSeconds(result) > 0);
  return results.find((result) => result.id === track.id && durationSeconds(result) > 0)
    || results.find((result) => {
      const resultArtist = normalize(result.artist);
      return normalize(result.title) === title && durationSeconds(result) > 0 && resultArtist
        && (resultArtist.includes(artist) || artist.includes(resultArtist));
    });
}

function parseAddedAt(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function trackAddedAt(track: LibraryTrack & { added_at?: string }): string {
  return parseAddedAt(track.addedAt) || parseAddedAt(track.added_at);
}

export function formatAddedAt(value?: string): string {
  const iso = parseAddedAt(value);
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function withLibraryMeta(track: Track | LibraryTrack, addedAt?: string): LibraryTrack {
  const existing = track as LibraryTrack & { added_at?: string };
  const stamp = parseAddedAt(addedAt) || trackAddedAt(existing) || new Date().toISOString();
  const { added_at: _legacy, ...rest } = existing;
  return { ...rest, addedAt: stamp };
}

function normalizeData(data: Data): { data: Data; changed: boolean } {
  let changed = false;
  const fixTrack = (track: LibraryTrack) => {
    const next = withLibraryMeta(track);
    if (next.addedAt !== track.addedAt || (track as { added_at?: string }).added_at) changed = true;
    return next;
  };
  const liked = (Array.isArray(data.liked) ? data.liked : []).map(fixTrack);
  const playlists = (Array.isArray(data.playlists) ? data.playlists : []).map((playlist) => ({
    ...playlist,
    tracks: (Array.isArray(playlist.tracks) ? playlist.tracks : []).map(fixTrack),
  }));
  return { data: { liked, playlists }, changed };
}

function read(): Data {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "{}");
    const { data, changed } = normalizeData({
      liked: Array.isArray(raw.liked) ? raw.liked : [],
      playlists: Array.isArray(raw.playlists) ? raw.playlists : [],
    });
    if (changed) localStorage.setItem(key, JSON.stringify(data));
    return data;
  } catch {
    return { liked: [], playlists: [] };
  }
}

export function useLibrary() {
  const [data, setData] = useState(read);
  const [error, setError] = useState("");
  const durationSyncRequested = useRef(new Set<string>());
  const update = (change: (current: Data) => Data) => setData((current) => {
    const next = change(current);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setError("");
      return next;
    } catch {
      setError("Library changes could not be saved.");
      return current;
    }
  });
  useEffect(() => {
    const tracks = [...new Map([...data.liked, ...data.playlists.flatMap((playlist) => playlist.tracks)]
      .filter((track) => !durationSeconds(track) && !durationSyncRequested.current.has(track.id))
      .map((track) => [track.id, track])).values()];
    tracks.forEach((track) => durationSyncRequested.current.add(track.id));
    let next = 0;
    const sync = async () => {
      while (next < tracks.length) {
        const track = tracks[next++];
        try {
          const match = matchingDuration(track, await Music.search(`${track.title} ${track.artist}`));
          const seconds = match ? durationSeconds(match) : 0;
          if (!seconds) {
            durationSyncRequested.current.delete(track.id);
            continue;
          }
          const duration = match!.duration || formatDurationSeconds(seconds);
          update((current) => {
            const withDuration = (item: LibraryTrack) => item.id === track.id && !durationSeconds(item)
              ? withLibraryMeta({ ...item, duration, duration_seconds: seconds }, item.addedAt)
              : item;
            return {
              liked: current.liked.map(withDuration),
              playlists: current.playlists.map((playlist) => ({ ...playlist, tracks: playlist.tracks.map(withDuration) })),
            };
          });
        } catch {
          durationSyncRequested.current.delete(track.id);
          continue;
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(2, tracks.length) }, sync));
  }, [data.liked, data.playlists]);
  const toggleLike = (track: Track) => update((current) => ({
    ...current,
    liked: current.liked.some((item) => item.id === track.id)
      ? current.liked.filter((item) => item.id !== track.id)
      : [withLibraryMeta(track), ...current.liked],
  }));
  const create = (name: string, description: string, cover?: string) => {
    const playlist = { id: crypto.randomUUID(), name, description, cover, tracks: [] as LibraryTrack[] };
    update((current) => ({ ...current, playlists: [playlist, ...current.playlists] }));
    return playlist;
  };
  const add = (id: string, track: Track) => update((current) => ({
    ...current,
    playlists: current.playlists.map((playlist) => playlist.id === id && !playlist.tracks.some((item) => item.id === track.id)
      ? { ...playlist, tracks: [...playlist.tracks, withLibraryMeta(track)] }
      : playlist),
  }));
  const remove = (id: string, track: Track) => update((current) => ({
    ...current,
    playlists: current.playlists.map((playlist) => playlist.id === id
      ? { ...playlist, tracks: playlist.tracks.filter((item) => item.id !== track.id) }
      : playlist),
  }));
  const edit = (id: string, name: string, description: string, cover?: string) => update((current) => ({
    ...current,
    playlists: current.playlists.map((playlist) => playlist.id === id ? { ...playlist, name, description, cover } : playlist),
  }));
  const removePlaylist = (id: string) => update((current) => ({
    ...current,
    playlists: current.playlists.filter((playlist) => playlist.id !== id),
  }));
  const ensureDuration = (id: string, seconds: number) => {
    const total = Math.max(0, Math.floor(seconds));
    if (!id || !total) return;
    update((current) => {
      let changed = false;
      const apply = (item: LibraryTrack) => {
        if (item.id !== id || durationSeconds(item) > 0) return item;
        changed = true;
        return withLibraryMeta(withTrackDuration(item, total), item.addedAt);
      };
      const liked = current.liked.map(apply);
      const playlists = current.playlists.map((playlist) => ({ ...playlist, tracks: playlist.tracks.map(apply) }));
      return changed ? { liked, playlists } : current;
    });
  };
  return { ...data, error, clearError: () => setError(""), toggleLike, create, add, remove, edit, removePlaylist, ensureDuration };
}
