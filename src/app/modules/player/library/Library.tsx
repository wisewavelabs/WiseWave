import { useEffect, useRef, useState } from "react";
import { ListMusic, Plus, Search } from "lucide-react";
import type { LibraryTrack, Playlist } from "./useLibrary";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { IconButton } from "../../../shared/ui/IconButton";
import { trackDurationSeconds } from "../shared/trackDuration";
import { PlaylistDialog } from "./PlaylistDialog";
import { usePlaylistMenu } from "./PlaylistMenu";
import { LikedSongsCover } from "./LikedSongsCover";

function tracksMeta(tracks: LibraryTrack[]) {
  const songs = tracks.length;
  const minutes = Math.max(0, Math.floor(tracks.reduce((sum, track) => sum + trackDurationSeconds(track), 0) / 60));
  return `${songs} ${songs === 1 ? "song" : "songs"} of ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function Library({ width, liked, playlists, active, onOpen, onCreate }: { width: number; liked: LibraryTrack[]; playlists: Playlist[]; active: string; onOpen: (id: string) => void; onCreate: (name: string, description: string, cover?: string) => void }) {
  const openPlaylistMenu = usePlaylistMenu();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const visible = playlists.filter((playlist) => playlist.name.toLowerCase().includes(query.trim().toLowerCase()));

  return <aside className="library" style={{ width }}>
    <div className="library-heading"><span>Your Library</span><div className="library-actions"><Tooltip label="Create playlist"><button className="create" type="button" onClick={() => setCreating(true)}><Plus size={14} />Create</button></Tooltip></div></div>
    <div className="library-tools"><div className={`library-search ${searchOpen ? "open" : ""}`}><IconButton label="Search in library" onClick={() => setSearchOpen((open) => !open)}><Search size={16} /></IconButton><input aria-label="Filter library" placeholder="Filter library" value={query} tabIndex={searchOpen ? 0 : -1} ref={searchInput} onBlur={(event) => { if (!query && !event.currentTarget.parentElement?.contains(event.relatedTarget as Node)) setSearchOpen(false); }} onChange={(event) => setQuery(event.target.value)} /></div></div>
    <div className="library-liked">
      <button className="library-item" type="button" aria-current={active === "liked" ? "page" : undefined} onClick={() => onOpen("liked")}>
        <LikedSongsCover className="liked-cover" />
        <span><strong>Liked Songs</strong><small>{tracksMeta(liked)}</small></span>
      </button>
    </div>
    <nav className="library-list" aria-label="Playlists">{visible.length ? visible.map((playlist) => <button className="library-item" type="button" aria-current={active === playlist.id ? "page" : undefined} key={playlist.id} onContextMenu={(event) => openPlaylistMenu(event, playlist)} onClick={() => onOpen(playlist.id)}><span className="playlist-cover">{playlist.cover ? <img src={playlist.cover} alt="" /> : <ListMusic size={20} />}</span><span><strong>{playlist.name}</strong><small>{tracksMeta(playlist.tracks)}</small></span></button>) : <div className="library-empty"><ListMusic size={24} /><strong>No playlists found</strong><span>{query ? "Try another search." : "Create one to start your collection."}</span></div>}</nav>
    {creating && <PlaylistDialog onClose={() => setCreating(false)} onCreate={(name, description, cover) => { onCreate(name, description, cover); setCreating(false); }} />}

  </aside>;
}
