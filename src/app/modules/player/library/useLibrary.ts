import { useState } from "react";
import type { Track } from "../../../mygo";

export type LibraryTrack = Track & { addedAt?: string };
export type Playlist = { id: string; name: string; description: string; cover?: string; tracks: LibraryTrack[] };
type Data = { liked: LibraryTrack[]; playlists: Playlist[] };
const key = "wisewave-library";
function read(): Data {
  try { const data = JSON.parse(localStorage.getItem(key) || "{}"); return { liked: Array.isArray(data.liked) ? data.liked : [], playlists: Array.isArray(data.playlists) ? data.playlists : [] }; }
  catch { return { liked: [], playlists: [] }; }
}
export function useLibrary() {
  const [data, setData] = useState(read);
  const [error, setError] = useState("");
  const update = (change: (current: Data) => Data) => setData((current) => { const next = change(current); try { localStorage.setItem(key, JSON.stringify(next)); setError(""); return next; } catch { setError("Library changes could not be saved."); return current; } });
  const toggleLike = (track: Track) => { const addedAt = new Date().toISOString(); update((current) => ({ ...current, liked: current.liked.some((item) => item.id === track.id) ? current.liked.filter((item) => item.id !== track.id) : [{ ...track, addedAt }, ...current.liked] })); };
  const create = (name: string, description: string, cover?: string) => { const playlist = { id: crypto.randomUUID(), name, description, cover, tracks: [] }; update((current) => ({ ...current, playlists: [playlist, ...current.playlists] })); return playlist; };
  const add = (id: string, track: Track) => { const addedAt = new Date().toISOString(); update((current) => ({ ...current, playlists: current.playlists.map((playlist) => playlist.id === id && !playlist.tracks.some((item) => item.id === track.id) ? { ...playlist, tracks: [...playlist.tracks, { ...track, addedAt }] } : playlist) })); };
  const remove = (id: string, track: Track) => update((current) => ({ ...current, playlists: current.playlists.map((playlist) => playlist.id === id ? { ...playlist, tracks: playlist.tracks.filter((item) => item.id !== track.id) } : playlist) }));
  return { ...data, error, clearError: () => setError(""), toggleLike, create, add, remove };
}
