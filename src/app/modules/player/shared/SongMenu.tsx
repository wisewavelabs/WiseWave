import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, CirclePlus, Clipboard, Disc3, Heart, ListPlus, Plus, Radio, Search, Trash2, UserRound } from "lucide-react";
import { Clipboard as NativeClipboard, type Track } from "../../../mygo";
import type { Playlist } from "../library/useLibrary";
import { PlaylistDialog } from "../library/PlaylistDialog";
import { artistNames } from "./ArtistLinks";

type Location = { kind: "liked" } | { kind: "playlist"; id: string } | { kind: "queue"; index: number };
type MenuState = { track: Track; x: number; y: number; location?: Location };
type OpenMenu = (event: MouseEvent, track: Track, location?: Location) => void;
const SongMenuContext = createContext<OpenMenu | null>(null);
export function useSongMenu() {
  const open = useContext(SongMenuContext);
  if (!open) throw new Error("Song menu is unavailable");
  return open;
}

export function SongMenuTarget({ track, className, children }: { track: Track; className: string; children: ReactNode }) {
  const open = useSongMenu();
  return <div className={className} onContextMenu={(event) => open(event, track)}>{children}</div>;
}

export function SongMenuProvider({ children, liked, playlists, onLike, onAdd, onCreateAndAdd, onRemove, onQueue, onRemoveQueue, onArtist, onAlbum, onRadio, onError }: {
  children: ReactNode;
  liked: Track[];
  playlists: Playlist[];
  onLike: (track: Track) => void;
  onAdd: (id: string, track: Track) => void;
  onCreateAndAdd: (name: string, description: string, track: Track, cover?: string) => void;
  onRemove?: (id: string, track: Track) => void;
  onQueue: (track: Track) => void;
  onRemoveQueue?: (index: number, track: Track) => void;
  onArtist: (track: Track) => void;
  onAlbum: (id: string, track: Track) => void;
  onRadio: (track: Track) => void;
  onError: (message: string) => void;
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [submenu, setSubmenu] = useState(false);
  const [filter, setFilter] = useState("");
  const [createFor, setCreateFor] = useState<Track | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0, flip: false });
  const root = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const close = useCallback((restore = false) => {
    setMenu(null);
    if (restore) previousFocus.current?.focus();
  }, []);
  const open = useCallback<OpenMenu>((event, track, location) => {
    event.preventDefault();
    event.stopPropagation();
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSubmenu(false);
    setFilter("");
    const rect = event.currentTarget.getBoundingClientRect();
    const anchored = event.type === "click" || (event.clientX === 0 && event.clientY === 0);
    setMenu({ track, x: anchored ? rect.left : event.clientX, y: anchored ? rect.bottom : event.clientY, location });
  }, []);

  useLayoutEffect(() => {
    if (!menu || !root.current) return;
    const { width, height } = root.current.getBoundingClientRect();
    const submenuHeight = root.current.querySelector<HTMLElement>(".song-menu-submenu")?.offsetHeight ?? 0;
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - width - 8));
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - Math.max(height, submenuHeight) - 8));
    setPosition({ x, y, flip: x + width + 224 > window.innerWidth - 8 });
  }, [menu, submenu, filter, playlists.length]);

  useLayoutEffect(() => {
    if (menu) root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => {
      const element = event.target instanceof HTMLElement ? event.target : null;
      if (event.key === "Escape" || (event.key === "ArrowLeft" && element?.closest(".song-menu-submenu"))) {
        event.preventDefault();
        if (submenu) { setSubmenu(false); root.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus(); }
        else close(true);
        return;
      }
      if (event.key === "ArrowRight" && element?.getAttribute("aria-haspopup") === "menu") {
        event.preventDefault();
        setSubmenu(true);
        requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('.song-menu-submenu [role="menuitem"]')?.focus());
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (element?.tagName === "INPUT") return;
      const currentMenu = element?.closest('[role="menu"]');
      const items = Array.from(currentMenu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(element as HTMLButtonElement);
      items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    };
    const dismiss = (event: Event) => { if (!(event.target instanceof Node) || !root.current?.contains(event.target)) close(); };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [menu, submenu, close]);

  const track = menu?.track;
  const saved = Boolean(track && liked.some((item) => item.id === track.id));
  const firstArtist = track ? artistNames(track.artist)[0] : undefined;
  const playlistId = menu?.location?.kind === "playlist" ? menu.location.id : undefined;
  const queueIndex = menu?.location?.kind === "queue" ? menu.location.index : undefined;
  const matching = playlists.filter((playlist) => playlist.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const perform = (action: () => void) => { action(); close(true); };

  return <SongMenuContext.Provider value={open}>
    {children}
    {createFor && <PlaylistDialog onClose={() => setCreateFor(null)} onCreate={(name, description, cover) => { onCreateAndAdd(name, description, createFor, cover); setCreateFor(null); }} />}
    {menu && track && createPortal(
      <div ref={root} className="song-menu" style={{ left: position.x, top: position.y }} onContextMenu={(event) => event.preventDefault()}>
        <div className="song-menu-list" role="menu" aria-label={`Options for ${track.title}`}>
          <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={submenu} onPointerEnter={() => setSubmenu(true)} onClick={() => setSubmenu(true)}><CirclePlus /><span>Add to playlist</span><ChevronRight /></button>
          {playlistId !== undefined && onRemove && <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onRemove(playlistId, track))}><Trash2 /><span>Remove from playlist</span></button>}
          {queueIndex !== undefined && onRemoveQueue && <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onRemoveQueue(queueIndex, track))}><Trash2 /><span>Remove from queue</span></button>}
          <div className="song-menu-divider" role="separator" />
          <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onLike(track))}><Heart fill={saved ? "currentColor" : "none"} /><span>{saved ? "Remove from Liked Songs" : "Save to Liked Songs"}</span></button>
          <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onQueue(track))}><ListPlus /><span>Add to queue</span></button>
          <div className="song-menu-divider" role="separator" />
          <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onRadio(track))}><Radio /><span>Go to song radio</span></button>
          {firstArtist && <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onArtist({ ...track, artist: firstArtist }))}><UserRound /><span>Go to artist</span></button>}
          {track.album_id && <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => perform(() => onAlbum(track.album_id, track))}><Disc3 /><span>Go to album</span></button>}
          <div className="song-menu-divider" role="separator" />
          <button type="button" role="menuitem" onPointerEnter={() => setSubmenu(false)} onClick={() => { void NativeClipboard.writeText(`https://music.youtube.com/watch?v=${encodeURIComponent(track.id)}`).catch(() => onError("Could not copy the song link.")); close(true); }}><Clipboard /><span>Copy song link</span></button>
        </div>
        {submenu && <div className={`song-menu-submenu ${position.flip ? "flip" : ""}`} role="menu" aria-label="Add to playlist">
          <button type="button" role="menuitem" onClick={() => { setCreateFor(track); close(); }}><Plus /><span>New playlist</span></button>
          <label className="song-menu-search"><Search /><input aria-label="Find a playlist" placeholder="Find a playlist" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
          <div className="song-menu-playlists">
            {matching.map((playlist) => { const contains = playlist.tracks.some((item) => item.id === track.id); return <button type="button" role="menuitem" key={playlist.id} disabled={contains} onClick={() => perform(() => onAdd(playlist.id, track))}><span>{playlist.name}</span>{contains && <Check />}</button>; })}
            {!matching.length && <p>{playlists.length ? "No playlists found" : "No playlists yet"}</p>}
          </div>
        </div>}
      </div>, document.body
    )}
  </SongMenuContext.Provider>;
}
