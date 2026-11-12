import { createContext, useCallback, useContext, useLayoutEffect, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ListPlus, Pencil, Play, Trash2 } from "lucide-react";
import type { Playlist } from "./useLibrary";
import { PlaylistDialog } from "./PlaylistDialog";

type OpenMenu = (event: MouseEvent, playlist: Playlist) => void;
const Context = createContext<OpenMenu | null>(null);

export function usePlaylistMenu() {
  const open = useContext(Context);
  if (!open) throw new Error("Playlist menu is unavailable");
  return open;
}

export function PlaylistMenuProvider({ children, playlists, onPlay, onQueue, onEdit, onDelete }: {
  children: ReactNode;
  playlists: Playlist[];
  onPlay: (playlist: Playlist) => void;
  onQueue: (playlist: Playlist) => void;
  onEdit: (id: string, name: string, description: string, cover?: string) => void;
  onDelete: (playlist: Playlist) => void;
}) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const playlist = playlists.find((item) => item.id === menu?.id);
  const editPlaylist = playlists.find((item) => item.id === editing);
  const close = (restore = false) => {
    setMenu(null);
    if (restore) previousFocus.current?.focus();
  };
  const open = useCallback<OpenMenu>((event, item) => {
    event.preventDefault();
    event.stopPropagation();
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchored = event.type === "click" || (!event.clientX && !event.clientY);
    setMenu({ id: item.id, x: anchored ? bounds.left : event.clientX, y: anchored ? bounds.bottom : event.clientY });
  }, []);

  useLayoutEffect(() => {
    if (!menu || !root.current) return;
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const node = root.current;
    node.style.left = `${Math.max(8, Math.min(menu.x / zoom, window.innerWidth / zoom - node.offsetWidth - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(menu.y / zoom, window.innerHeight / zoom - node.offsetHeight - 8))}px`;
    node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const dismiss = () => close();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); return; }
      if (event.key === "Tab") { close(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      items[next].focus();
    };
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
  }, [menu]);

  return <Context.Provider value={open}>
    {children}
    {editPlaylist && <PlaylistDialog playlist={editPlaylist} onClose={() => setEditing(null)} onCreate={(name, description, cover) => { onEdit(editPlaylist.id, name, description, cover); setEditing(null); }} />}
    {menu && playlist && createPortal(<div ref={root} className="song-menu" onContextMenu={(event) => event.preventDefault()}>
      <div className="song-menu-list" role="menu" aria-label={`Actions for ${playlist.name}`}>
        <button type="button" role="menuitem" disabled={!playlist.tracks.length} onClick={() => { onPlay(playlist); close(true); }}><Play /><span>Play</span></button>
        <button type="button" role="menuitem" disabled={!playlist.tracks.length} onClick={() => { onQueue(playlist); close(true); }}><ListPlus /><span>Add to queue</span></button>
        <div className="song-menu-divider" role="separator" />
        <button type="button" role="menuitem" onClick={() => { close(true); setEditing(playlist.id); }}><Pencil /><span>Edit details</span></button>
        <div className="song-menu-divider" role="separator" />
        <button type="button" role="menuitem" className="song-menu-danger" onClick={() => { onDelete(playlist); close(true); }}><Trash2 /><span>Delete</span></button>
      </div>
    </div>, document.body)}
  </Context.Provider>;
}
