import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LockKeyhole, LockKeyholeOpen, PanelRight, Play } from "lucide-react";
import { HomeIcon } from "../../shared/ui/icons";
import { MiniWindow, Music, TrayControl, type CatalogAlbum, type CatalogArtist, type Track } from "../../mygo";
import { IconButton } from "../../shared/ui/IconButton";
import { Tooltip } from "../../shared/ui/Tooltip";
import { Connection } from "../connection/Connection";
import { Settings } from "../settings/Settings";
import { SettingsLottieIcon } from "../settings/SettingsIcon";
import { ResizeHandle } from "./shared/ResizeHandle";
import { Artwork } from "../../shared/ui/Artwork";
import { MarqueeText } from "../../shared/ui/MarqueeText";
import { Feed } from "./catalog/Feed";
import { PlayerBar } from "./playback/PlayerBar";
import { SearchBox } from "./search/SearchBox";
import type { SearchCategory } from "./search/SearchResults";
import type { MiniState } from "./mini/MiniPlayer";
import { Shortcuts } from "./shared/Shortcuts";
import { Library } from "./library/Library";
import { Collection } from "./library/Collection";
import { useLibrary } from "./library/useLibrary";
import { PlaylistMenuProvider } from "./library/PlaylistMenu";
import { Album } from "./catalog/Album";
import { Artist } from "./catalog/Artist";
import { ArtistLinks } from "./shared/ArtistLinks";
import { ArtistAbout } from "./shared/ArtistAbout";
import { useMusic } from "./playback/useMusic";
import { Lyrics } from "./lyric-view/Lyrics";
import { PlayerAlert } from "./shared/PlayerAlert";
import { ArtworkViewer } from "./shared/ArtworkViewer";
import { SongMenuProvider, SongMenuTarget } from "./shared/SongMenu";

export function Player() {
  const [nowPlaying, setNowPlaying] = useState(true);
  const [artworkOpen, setArtworkOpen] = useState(false);
  const [libraryWidth, setLibraryWidth] = useState(335);
  const [nowPlayingWidth, setNowPlayingWidth] = useState(281);
  const [resizing, setResizing] = useState(false);
  const music = useMusic();
  const library = useLibrary();
  useEffect(() => {
    if (music.track?.id && music.duration > 0) library.ensureDuration(music.track.id, music.duration);
  }, [music.track?.id, music.duration]);
  const [pages, setPages] = useState<{ view: "home" | "search" | "mix" | "lyrics" | "artist" | "liked" | "playlist" | "album"; albumId?: string; query?: string; category?: SearchCategory; mix?: Track; artist?: { artist: string; artist_id?: string }; playlistId?: string }[]>([{ view: "home" }]);
  const [pageIndex, setPageIndex] = useState(0);
  const page = pages[pageIndex];
  const query = page.view === "search" ? page.query || "" : "";
  const homeRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<number[]>([0]);
  useLayoutEffect(() => {
    const viewport = homeRef.current;
    if (!viewport) return;
    const target = scrollPositions.current[pageIndex] ?? 0;
    viewport.scrollTop = target;
    if (!target || viewport.scrollTop >= target - 1) return;
    let content: Element | null = null;
    const resize = new ResizeObserver(() => restore());
    const mutation = new MutationObserver(() => restore());
    const stop = () => { resize.disconnect(); mutation.disconnect(); viewport.removeEventListener("wheel", stop); viewport.removeEventListener("pointerdown", stop); viewport.removeEventListener("touchstart", stop); };
    const restore = () => {
      if (content !== viewport.firstElementChild) {
        if (content) resize.unobserve(content);
        content = viewport.firstElementChild;
        if (content) resize.observe(content);
      }
      viewport.scrollTop = target;
      if (viewport.scrollTop >= target - 1) stop();
    };
    mutation.observe(viewport, { childList: true, subtree: true });
    viewport.addEventListener("wheel", stop, { passive: true });
    viewport.addEventListener("pointerdown", stop, { passive: true });
    viewport.addEventListener("touchstart", stop, { passive: true });
    restore();
    return stop;
  }, [pageIndex]);
  const goHistory = (index: number) => {
    if (index < 0 || index >= pages.length || index === pageIndex) return;
    scrollPositions.current[pageIndex] = homeRef.current?.scrollTop ?? 0;
    setPageIndex(index);
  };
  const navigate = (next: typeof page) => {
    if (page.view === next.view && page.query === next.query && page.mix?.id === next.mix?.id && page.artist?.artist_id === next.artist?.artist_id && page.artist?.artist === next.artist?.artist && page.playlistId === next.playlistId && page.albumId === next.albumId) return;
    scrollPositions.current[pageIndex] = homeRef.current?.scrollTop ?? 0;
    scrollPositions.current = [...scrollPositions.current.slice(0, pageIndex + 1), 0];
    setPages((previous) => [...previous.slice(0, pageIndex + 1), next]);
    setPageIndex(pageIndex + 1);
  };
  const search = (value: string) => {
    const next = value ? { view: "search" as const, query: value } : { view: "home" as const };
    navigate(next);
  };
  const setSearchCategory = (category: SearchCategory) => {
    setPages((previous) => previous.map((entry, index) => index === pageIndex ? { ...entry, category } : entry));
  };
  const saveSearch = useRef<(query: string) => void>(() => {});
  const [results, setResults] = useState<Track[]>([]);
  const [albumResults, setAlbumResults] = useState<CatalogAlbum[]>([]);
  const [artistResults, setArtistResults] = useState<CatalogArtist[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const lyricsOpen = page.view === "lyrics";
  const toggleLyrics = () => {
    if (lyricsOpen) {
      if (pageIndex > 0) goHistory(pageIndex - 1);
      else navigate({ view: "home" });
    } else {
      navigate({ view: "lyrics" });
    }
  };
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsClicks, setSettingsClicks] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [miniOpen, setMiniOpen] = useState(false);
  const miniChannel = useRef<BroadcastChannel | null>(null);
  const miniArtist = useRef<(track: Track) => void>(() => {});
  miniArtist.current = (artist) => { navigate({ view: "artist", artist }); void TrayControl.action("open").catch(() => music.setError("Could not open the player.")); };
  const miniActions = useRef({ previous: () => {}, next: () => {}, toggle: () => {}, mute: () => {}, seek: (_value: number) => {}, volume: (_value: number) => {}, like: () => {} });
  miniActions.current = { previous: () => { if (music.history.length > 1) music.play(music.history[1]); }, next: music.next, toggle: music.toggle, mute: music.toggleMute, seek: music.seek, volume: music.changeVolume, like: () => { if (music.track) library.toggleLike(music.track); } };
  const isLiked = Boolean(music.track && library.liked.some((item) => item.id === music.track?.id));
  const miniState: MiniState = { track: music.track, playing: music.playing, position: music.position, duration: music.duration, volume: music.volume, muted: music.muted, hasPrevious: music.history.length > 1, hasNext: Boolean(music.queue.length || music.autoplay), liked: isLiked };
  const stateRef = useRef(miniState);
  stateRef.current = miniState;
  useEffect(() => {
    const bus = new BroadcastChannel("wisewave-mini");
    miniChannel.current = bus;
    bus.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "request") { setMiniOpen(true); bus.postMessage({ type: "state", state: stateRef.current }); }
      else if (message?.type === "closed") setMiniOpen(false);
      else if (message?.type === "artist" && message.track?.id === stateRef.current.track?.id && typeof message.track.artist === "string") miniArtist.current(message.track);
      else if (message?.type === "action" && message.trackId === stateRef.current.track?.id) {
        const actions = miniActions.current;
        if (message.action === "previous") actions.previous();
        else if (message.action === "next") actions.next();
        else if (message.action === "toggle") actions.toggle();
        else if (message.action === "mute") actions.mute();
        else if (message.action === "like") actions.like();
        else if (message.action === "seek" && typeof message.value === "number" && Number.isFinite(message.value)) actions.seek(Math.max(0, Math.min(message.value, stateRef.current.duration)));
        else if (message.action === "volume" && typeof message.value === "number" && Number.isFinite(message.value)) actions.volume(Math.max(0, Math.min(message.value, 100)));
      }
    };
    return () => { bus.close(); miniChannel.current = null; };
  }, []);
  useEffect(() => { if (miniOpen) miniChannel.current?.postMessage({ type: "state", state: miniState }); }, [miniOpen, music.track, music.playing, music.position, music.duration, music.volume, music.muted, music.history.length, music.queue.length, music.autoplay, isLiked]);
  const toggleMini = () => { void (miniOpen ? MiniWindow.close() : MiniWindow.open()).then(() => setMiniOpen(!miniOpen)).catch(() => music.setError("Mini player could not be opened.")); };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const key = event.key.toLowerCase();
      const primary = event.ctrlKey || event.metaKey;
      if (primary && (key === "/" || event.code === "Slash")) { event.preventDefault(); setShortcutsOpen((open) => !open); return; }
      if (event.key === "Escape" && shortcutsOpen) { event.preventDefault(); setShortcutsOpen(false); return; }
      if (shortcutsOpen || settingsOpen) return;
      if (primary && key === "k" && !event.altKey && !event.shiftKey) { event.preventDefault(); document.querySelector<HTMLInputElement>('.search input')?.focus(); return; }
      if (!primary && event.altKey && !event.shiftKey && (key === "arrowleft" || key === "arrowright")) {
        event.preventDefault();
        goHistory(pageIndex + (key === "arrowleft" ? -1 : 1));
        return;
      }
      if (!music.track || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="textbox"]'))) return;
      if (key === " " && !primary && !event.altKey && !event.shiftKey) { event.preventDefault(); music.toggle(); return; }
      if (event.target instanceof Element && event.target.closest('a, button, [role="button"], [role="menuitem"]')) return;
      if (primary && !event.altKey && !event.shiftKey && key === "arrowleft" && music.history.length > 1) { event.preventDefault(); music.play(music.history[1]); }
      else if (primary && !event.altKey && !event.shiftKey && key === "arrowright" && (music.queue.length > 0 || music.autoplay)) { event.preventDefault(); music.next(); }
      else if (!primary && event.shiftKey && !event.altKey && (key === "arrowleft" || key === "arrowright")) { event.preventDefault(); music.seek(Math.max(0, Math.min(music.duration || Infinity, music.position + (key === "arrowleft" ? -10 : 10)))); }
      else if (!primary && event.altKey && !event.shiftKey && key === "l") { event.preventDefault(); toggleLyrics(); }
      else if (!primary && event.altKey && !event.shiftKey && key === "m") { event.preventDefault(); toggleMini(); }
      else if (!primary && event.altKey && !event.shiftKey && key === "r") { event.preventDefault(); music.cycleRepeat(); }
      else if (!primary && event.altKey && !event.shiftKey && (key === "arrowup" || key === "arrowdown")) { event.preventDefault(); music.changeVolume(Math.max(0, Math.min(100, music.volume + (key === "arrowup" ? 10 : -10)))); }
      else if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === "m") { event.preventDefault(); music.toggleMute(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setAlbumResults([]); setArtistResults([]); setSearchLoading(false); setSearchError(""); return; }
    let active = true;
    setSearchLoading(true); setSearchError(""); setResults([]); setAlbumResults([]); setArtistResults([]);
    const timer = window.setTimeout(() => {
      Promise.allSettled([Music.search(q), Music.albums(q), Music.artists(q)]).then(([tracksRes, albumsRes, artistsRes]) => {
        if (!active) return;
        setResults(tracksRes.status === "fulfilled" ? tracksRes.value : []);
        setAlbumResults(albumsRes.status === "fulfilled" ? albumsRes.value : []);
        setArtistResults(artistsRes.status === "fulfilled" ? artistsRes.value : []);
        const failures = [tracksRes, albumsRes, artistsRes].filter((result) => result.status === "rejected").length;
        if (failures) {
          setSearchError(failures === 3 ? "Search is unavailable. Try again." : "Some results could not be loaded. Try again.");
        }
        if (failures === 3) {
          music.setError("Search is unavailable.");
        }
      }).finally(() => { if (active) setSearchLoading(false); });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);
  return <PlaylistMenuProvider playlists={library.playlists} onEdit={library.edit} onDelete={(playlist) => { library.removePlaylist(playlist.id); if (page.view === "playlist" && page.playlistId === playlist.id) navigate({ view: "home" }); }} onPlay={(playlist) => { if (playlist.tracks.length) music.play(playlist.tracks[0], playlist.tracks); }} onQueue={(playlist) => music.setQueue((items) => [...items, ...playlist.tracks.filter((track, index, tracks) => !items.some((item) => item.id === track.id) && tracks.findIndex((item) => item.id === track.id) === index)])}><SongMenuProvider liked={library.liked} playlists={library.playlists} onLike={library.toggleLike} onAdd={library.add} onCreateAndAdd={(name, description, track, cover) => { const playlist = library.create(name, description, cover); library.add(playlist.id, track); }} onRemove={library.remove} onRemoveQueue={(index, track) => music.setQueue((items) => items[index]?.id === track.id ? items.filter((_, itemIndex) => itemIndex !== index) : items)} onQueue={(track) => music.setQueue((items) => items.some((item) => item.id === track.id) ? items : [...items, track])} onArtist={(track) => navigate({ view: "artist", artist: { artist: track.artist, artist_id: track.artist_id } })} onAlbum={(id) => navigate({ view: "album", albumId: id })} onRadio={(track) => navigate({ view: "mix", mix: track })} onError={music.setError}><main className="player">
    <header className="topbar">
      <div className="history-controls"><IconButton label="Go back" disabled={pageIndex === 0} onClick={() => goHistory(pageIndex - 1)}><ChevronLeft /></IconButton><IconButton label="Go forward" disabled={pageIndex >= pages.length - 1} onClick={() => goHistory(pageIndex + 1)}><ChevronRight /></IconButton></div>
      <div className="search-area"><Tooltip label="Home"><button className="home-button" type="button" aria-label="Home" onClick={() => navigate({ view: "home" })}><HomeIcon className="home-icon" /></button></Tooltip><SearchBox onArtist={(artist) => navigate({ view: "artist", artist })} results={results} loading={searchLoading} error={searchError} onSelect={(track, tracks) => music.play(track, tracks)} query={query} onChange={search} onCommit={(save) => { saveSearch.current = save; }} /></div>
      <div className="top-spacer"><Connection music={music} /><Tooltip label={music.privateListening ? "Private listening on" : "Private listening off"}><button className="privacy-trigger" type="button" aria-label={music.privateListening ? "Private listening on. Show activity on Discord" : "Private listening off. Hide activity on Discord"} aria-pressed={music.privateListening} onClick={music.togglePrivateListening}>{music.privateListening ? <LockKeyhole size={20} /> : <LockKeyholeOpen size={20} />}</button></Tooltip><Tooltip label="Settings"><button className="settings-trigger" type="button" aria-label="Settings" aria-pressed={settingsOpen} onClick={() => { setSettingsClicks((value) => value + 1); setSettingsOpen(true); }}><SettingsLottieIcon clicks={settingsClicks} /></button></Tooltip></div>
    </header>
    <div className="workspace">
      <><Library width={libraryWidth} liked={library.liked} playlists={library.playlists} active={page.playlistId || page.view} onOpen={(id) => navigate(id === "liked" ? { view: id } : { view: "playlist", playlistId: id })} onCreate={(name, description, cover) => { const playlist = library.create(name, description, cover); navigate({ view: "playlist", playlistId: playlist.id }); }} /><ResizeHandle label="Resize library sidebar" min={280} max={420} value={libraryWidth} onChange={setLibraryWidth} /></>
      <section ref={homeRef} className={`home-view ${page.view === "mix" ? "mix-mode" : ""}`}>
        {page.view === "album" && page.albumId ? <Album id={page.albumId} onBack={() => pageIndex > 0 ? goHistory(pageIndex - 1) : navigate({ view: "home" })} onPlay={music.play} onArtist={(artist) => navigate({ view: "artist", artist })} /> : page.view === "liked" || page.view === "playlist" ? <Collection key={page.playlistId || page.view} kind={page.view} playlist={library.playlists.find((item) => item.id === page.playlistId)} onArtist={(artist) => navigate({ view: "artist", artist })} tracks={page.view === "liked" ? library.liked : library.playlists.find((item) => item.id === page.playlistId)?.tracks || []} onPlay={music.play} /> : page.view === "artist" && page.artist ? <Artist key={page.artist.artist_id || page.artist.artist} id={page.artist.artist_id || ""} name={page.artist.artist} onBack={() => pageIndex > 0 ? goHistory(pageIndex - 1) : navigate({ view: "home" })} onPlay={music.play} onArtist={(artist) => navigate({ view: "artist", artist })} onAlbum={(albumId) => navigate({ view: "album", albumId })} /> : lyricsOpen && music.track ? <Lyrics credit={music.lyricsCredit} seekVersion={music.seekVersion} lines={music.lyrics} plain={music.plainLyrics} loading={music.lyricsLoading} position={music.position} duration={music.duration} playing={music.playing} track={music.track} onSeek={music.seek} /> : <Feed history={music.history} popular={music.popular} forYou={music.forYou} searchResults={results} albumResults={albumResults} artistResults={artistResults} searchLoading={searchLoading} searchError={searchError} searchQuery={query.trim()} searchCategory={page.category || "All"} onSearchCategory={setSearchCategory} onPlay={(track, tracks) => { if (query.trim()) saveSearch.current(query); music.play(track, tracks); }} mix={page.view === "mix" ? page.mix || null : null} onMix={(mix) => navigate(mix ? { view: "mix", mix } : { view: "home" })} onArtist={(artist) => { if (query.trim()) saveSearch.current(query); navigate({ view: "artist", artist }); }} onAlbum={(albumId) => { if (query.trim()) saveSearch.current(query); navigate({ view: "album", albumId }); }} onPlaylist={(playlistId) => { if (query.trim()) saveSearch.current(query); navigate({ view: "playlist", playlistId }); }} liked={library.liked} playlists={library.playlists} onLike={library.toggleLike} onAdd={library.add} current={music.track} queue={music.queue} onQueue={(track) => { if (query.trim()) saveSearch.current(query); music.setQueue((items) => items.some((item) => item.id === track.id) ? items : [...items, track]); }} />}
      </section>
      {nowPlaying && <ResizeHandle invert label="Resize now playing sidebar" min={240} max={480} value={nowPlayingWidth} onChange={setNowPlayingWidth} onDraggingChange={setResizing} />}
      <aside className={`now-playing ${nowPlaying ? "" : "collapsed"} ${resizing ? "resizing" : ""}`} style={{ width: nowPlaying ? nowPlayingWidth : 56 }}>
        {nowPlaying ? <>
          <div className="now-heading"><IconButton label="Close now playing view" onClick={() => setNowPlaying(false)}><PanelRight size={16} /></IconButton><strong>Now playing</strong></div>
          <div className="now-playing-content player-scroll">
            {music.track ? <div className="now-track">
              <Tooltip label="Expand cover"><button className="now-artwork" type="button" aria-label="Expand album artwork" onClick={() => setArtworkOpen(true)}><Artwork src={music.track.album_art_url} size={560} /></button></Tooltip>
              <SongMenuTarget className="song-menu-title" track={music.track}>
                <MarqueeText className="now-title">{music.track.title}</MarqueeText>
              </SongMenuTarget>
              <MarqueeText className="track-artist">
                <ArtistLinks track={music.track} onOpen={(artist) => navigate({ view: "artist", artist })} />
              </MarqueeText>
              <ArtistAbout track={music.track} onArtist={(artist) => navigate({ view: "artist", artist })} />
            </div> : null}
          </div>
        </> : <IconButton label="Open now playing view" onClick={() => setNowPlaying(true)}><ChevronLeft size={36} /></IconButton>}
      </aside>
    </div>
    {artworkOpen && music.track && <ArtworkViewer track={music.track} onClose={() => setArtworkOpen(false)} />}
    {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} onClearHistory={music.clearHistory} onExportHistory={music.exportHistory} autoplay={music.autoplay} onAutoplay={music.setAutoplay} repeat={music.repeat} onRepeat={music.setRepeat} volume={music.volume} onVolume={music.changeVolume} discordEnabled={music.discordEnabled} onDiscordEnabled={music.toggleDiscord} track={music.track} position={music.position} duration={music.duration} />}
    {shortcutsOpen && <Shortcuts close={() => setShortcutsOpen(false)} />}
    <PlayerAlert message={music.error || library.error} onDismiss={() => { music.setError(""); library.clearError(); }} />
    <PlayerBar music={music} lyricsOpen={lyricsOpen} queueOpen={queueOpen} miniOpen={miniOpen} onLyrics={toggleLyrics} onQueue={() => setQueueOpen(!queueOpen)} onCloseQueue={() => setQueueOpen(false)} onMini={toggleMini} onArtist={(artist) => navigate({ view: "artist", artist })} onArtwork={() => setArtworkOpen(true)} liked={isLiked} onLike={() => { if (music.track) library.toggleLike(music.track); }} />
  </main></SongMenuProvider></PlaylistMenuProvider>;
}

