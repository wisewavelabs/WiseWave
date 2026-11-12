import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, LockKeyhole, LockKeyholeOpen, PanelRight, Play } from "lucide-react";
import { HomeIcon } from "../../shared/ui/icons";
import { MiniWindow, Music, TrayControl, events, type CatalogAlbum, type CatalogArtist, type CatalogPlaylist, type Track } from "../../mygo";
import { IconButton } from "../../shared/ui/IconButton";
import { Tooltip } from "../../shared/ui/Tooltip";
import { Connection } from "../connection/Connection";
import { SettingsLottieIcon } from "../settings/SettingsIcon";
import { ResizeHandle } from "./shared/ResizeHandle";
import { MarqueeText } from "../../shared/ui/MarqueeText";
import { Feed } from "./catalog/Feed";
import { NowArtwork, type NowMediaOpen } from "./playback/NowArtwork";
import { FullscreenPlayer } from "./playback/FullscreenPlayer";
import { PlayerBar } from "./playback/PlayerBar";
import { SearchBox } from "./search/SearchBox";
import type { SearchCategory } from "./search/SearchResults";
import { loadSearchPage, peekSearchPage } from "./search/searchCache";
import type { MiniState } from "./mini/MiniPlayer";
import { Shortcuts } from "./shared/Shortcuts";
import { Welcome, shouldShowWelcome } from "./shared/Welcome";
import { Library } from "./library/Library";
import { Collection } from "./library/Collection";
import { useLibrary } from "./library/useLibrary";
import { PlaylistMenuProvider } from "./library/PlaylistMenu";
import { Album } from "./catalog/Album";
import { Artist } from "./catalog/Artist";
import { Playlist as CatalogPlaylistView } from "./catalog/Playlist";
import { ArtistLinks } from "./shared/ArtistLinks";
import { ArtistAbout } from "./shared/ArtistAbout";
import { useMusic } from "./playback/useMusic";
import { Lyrics } from "./lyric-view/Lyrics";
import { PlayerAlert } from "./shared/PlayerAlert";
import { ArtworkViewer } from "./shared/ArtworkViewer";
import { SongMenuProvider, SongMenuTarget } from "./shared/SongMenu";
type Page = { view: "home" | "search" | "mix" | "lyrics" | "artist" | "liked" | "playlist" | "album"; albumId?: string; query?: string; category?: SearchCategory; mix?: Track; artist?: { artist: string; artist_id?: string }; playlistId?: string };
const LAST_PAGE_KEY = "wisewave-last-page";
const loadSettings = () => import("../settings/Settings");
const Settings = lazy(() => loadSettings().then((module) => ({ default: module.Settings })));
const preloadSettings = () => { void loadSettings().catch((error) => console.warn("Could not preload settings", error)); };

function readLastPage(): { page: Page; scroll: number } {
  const fallback: { page: Page; scroll: number } = { page: { view: "home" }, scroll: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_PAGE_KEY) || "null");
    const page = saved?.page;
    if (!page || !["home", "search", "mix", "lyrics", "artist", "liked", "playlist", "album"].includes(page.view)) return fallback;
    if (page.view === "search" && typeof page.query !== "string") return fallback;
    if (page.view === "album" && typeof page.albumId !== "string") return fallback;
    if (page.view === "playlist" && typeof page.playlistId !== "string") return fallback;
    if (page.view === "artist" && typeof page.artist?.artist !== "string") return fallback;
    if (page.view === "mix" && (typeof page.mix?.id !== "string" || typeof page.mix?.artist !== "string" || typeof page.mix?.album_art_url !== "string")) return fallback;
    if (page.category && !["All", "Tracks", "Albums", "Artists", "Playlists"].includes(page.category)) delete page.category;
    return { page, scroll: Number.isFinite(saved.scroll) ? Math.max(0, saved.scroll) : 0 };
  } catch { return fallback; }
}

const PlayerSurface = memo(function PlayerSurface({ suspended, children }: { suspended: boolean; children: ReactNode }) {
  return <main className={`player${suspended ? " player-suspended" : ""}`} tabIndex={-1}>{children}</main>;
}, (previous, next) => previous.suspended && next.suspended);

export function Player() {
  useEffect(() => {
    let idle = 0;
    const timer = window.setTimeout(() => {
      if (document.hidden) return;
      if ("requestIdleCallback" in window) idle = window.requestIdleCallback(preloadSettings, { timeout: 3000 });
      else preloadSettings();
    }, 2000);
    return () => { window.clearTimeout(timer); if (idle) window.cancelIdleCallback(idle); };
  }, []);
  const [fullscreen, setFullscreen] = useState(false);
  const closingFullscreen = useRef(false);
  const fullscreenTransition = useRef<Promise<void>>(Promise.resolve());
  const openFullscreen = useCallback(() => { if (!closingFullscreen.current) setFullscreen(true); }, []);
  const closeFullscreen = useCallback(() => { closingFullscreen.current = true; setFullscreen(false); }, []);
  const [nowPlaying, setNowPlaying] = useState(true);
  const [mediaViewer, setMediaViewer] = useState<NowMediaOpen | null>(null);
  const [libraryWidth, setLibraryWidth] = useState(335);
  const [nowPlayingWidth, setNowPlayingWidth] = useState(320);
  const [resizing, setResizing] = useState(false);
  const music = useMusic();
  useEffect(() => {
    let active = true;
    fullscreenTransition.current = fullscreenTransition.current.then(async () => {
      await TrayControl.setPlayerFullscreen(fullscreen);
      if (!fullscreen) closingFullscreen.current = false;
    }).catch(() => {
      if (active) {
        music.setError(fullscreen ? "Could not enter full screen." : "Could not restore the player window.");
        if (fullscreen) closeFullscreen();
      }
      if (!fullscreen) closingFullscreen.current = false;
    });
    return () => { active = false; };
  }, [fullscreen, closeFullscreen, music.setError]);
  useEffect(() => () => {
    fullscreenTransition.current = fullscreenTransition.current.then(() => TrayControl.setPlayerFullscreen(false))
      .catch((error: unknown) => console.warn("Could not restore the player window.", error));
  }, []);
  const library = useLibrary();
  useEffect(() => {
    if (music.track?.id && music.duration > 0) library.ensureDuration(music.track.id, music.duration);
  }, [music.track?.id, music.duration]);
  const [lastPage] = useState(readLastPage);
  const [pages, setPages] = useState<Page[]>(() => lastPage.page.view === "home" ? [lastPage.page] : [{ view: "home" }, lastPage.page]);
  const [pageIndex, setPageIndex] = useState(() => lastPage.page.view === "home" ? 0 : 1);
  const page = pages[pageIndex];
  const query = page.view === "search" ? page.query || "" : "";
  const homeRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<number[]>(lastPage.page.view === "home" ? [lastPage.scroll] : [0, lastPage.scroll]);
  const restoringScroll = useRef(false);
  useLayoutEffect(() => {
    const viewport = homeRef.current;
    if (!viewport) return;
    const target = scrollPositions.current[pageIndex] ?? 0;
    let alive = true;
    restoringScroll.current = target > 0;
    let observer: ResizeObserver | null = null;
    let mutations: MutationObserver | null = null;
    let timer = 0;
    const stop = () => {
      restoringScroll.current = false;
      observer?.disconnect();
      mutations?.disconnect();
      window.clearTimeout(timer);
    };
    const restore = () => {
      if (!alive) return;
      viewport.scrollTop = target;
      if (Math.abs(viewport.scrollTop - target) <= 1) stop();
    };
    if (target > 0) {
      observer = new ResizeObserver(restore);
      mutations = new MutationObserver(() => {
        if (viewport.firstElementChild) observer?.observe(viewport.firstElementChild);
        restore();
      });
      observer.observe(viewport);
      if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
      mutations.observe(viewport, { childList: true, subtree: true });
      timer = window.setTimeout(stop, 10000);
      viewport.addEventListener("wheel", stop, { passive: true });
      viewport.addEventListener("pointerdown", stop, { passive: true });
      viewport.addEventListener("keydown", stop);
    }
    restore();
    return () => { alive = false; stop(); viewport.removeEventListener("wheel", stop); viewport.removeEventListener("pointerdown", stop); viewport.removeEventListener("keydown", stop); };
  }, [pageIndex]);
  useEffect(() => {
    const viewport = homeRef.current;
    if (!viewport) return;
    let timer = 0;
    const save = () => {
      const scroll = restoringScroll.current ? scrollPositions.current[pageIndex] ?? 0 : viewport.scrollTop;
      scrollPositions.current[pageIndex] = scroll;
      try { localStorage.setItem(LAST_PAGE_KEY, JSON.stringify({ page, scroll })); } catch {}
    };
    const onScroll = () => { window.clearTimeout(timer); timer = window.setTimeout(save, 200); };
    save();
    viewport.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => { window.clearTimeout(timer); viewport.removeEventListener("scroll", onScroll); window.removeEventListener("pagehide", save); };
  }, [page, pageIndex]);
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
  const [playlistResults, setPlaylistResults] = useState<CatalogPlaylist[]>([]);
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
  const [welcomeOpen, setWelcomeOpen] = useState(() => shouldShowWelcome());
  useEffect(() => events.trayAction.on((action) => {
    if (action === "acknowledgement") setWelcomeOpen(true);
  }), []);
  const [miniOpen, setMiniOpen] = useState(false);
  const miniChannel = useRef<BroadcastChannel | null>(null);
  const miniArtist = useRef<(track: Track) => void>(() => {});
  miniArtist.current = (artist) => { navigate({ view: "artist", artist }); void TrayControl.action("open").catch(() => music.setError("Could not open the player.")); };
  const miniActions = useRef({ previous: () => {}, next: () => {}, toggle: () => {}, mute: () => {}, seek: (_value: number) => {}, volume: (_value: number) => {}, like: () => {} });
  miniActions.current = { previous: music.previous, next: music.next, toggle: music.toggle, mute: music.toggleMute, seek: music.seek, volume: music.changeVolume, like: () => { if (music.track) library.toggleLike(music.track); } };
  const isLiked = Boolean(music.track && library.liked.some((item) => item.id === music.track?.id));
  const miniState: MiniState = { track: music.track, playing: music.playing, position: music.position, duration: music.duration, volume: music.volume, muted: music.muted, hasPrevious: Boolean(music.track), hasNext: Boolean(music.track && (music.queue.length || music.upNext.length || music.repeatMode === "queue" || music.autoplay)), liked: isLiked };
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
  useEffect(() => { if (miniOpen) miniChannel.current?.postMessage({ type: "state", state: miniState }); }, [miniOpen, music.track, music.playing, music.position, music.duration, music.volume, music.muted, music.queue.length, music.upNext.length, music.repeatMode, music.autoplay, isLiked]);
  const toggleMini = () => { void (miniOpen ? MiniWindow.close() : MiniWindow.open()).then(() => setMiniOpen(!miniOpen)).catch(() => music.setError("Mini player could not be opened.")); };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (fullscreen) return;
      const key = event.key.toLowerCase();
      const primary = event.ctrlKey || event.metaKey;
      if (primary && (key === "/" || event.code === "Slash")) { event.preventDefault(); setShortcutsOpen((open) => !open); return; }
      if (event.key === "Escape" && welcomeOpen) return;
      if (event.key === "Escape" && shortcutsOpen) { event.preventDefault(); setShortcutsOpen(false); return; }
      if (shortcutsOpen || settingsOpen || welcomeOpen) return;
      if (primary && key === "k" && !event.altKey && !event.shiftKey) { event.preventDefault(); const input = document.querySelector<HTMLInputElement>('.search input'); input?.focus(); input?.click(); return; }
      if (!primary && event.altKey && !event.shiftKey && (key === "arrowleft" || key === "arrowright")) {
        event.preventDefault();
        goHistory(pageIndex + (key === "arrowleft" ? -1 : 1));
        return;
      }
      if (!music.track || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="textbox"]'))) return;
      if (key === " " && !primary && !event.altKey && !event.shiftKey) { event.preventDefault(); music.toggle(); return; }
      if (event.target instanceof Element && event.target.closest('a, button, [role="button"], [role="menuitem"]')) return;
      if (primary && !event.altKey && !event.shiftKey && key === "arrowleft" && music.track) { event.preventDefault(); music.previous(); }
      else if (primary && !event.altKey && !event.shiftKey && key === "arrowright" && music.track && (music.queue.length > 0 || music.upNext.length > 0 || music.repeatMode === "queue" || music.autoplay)) { event.preventDefault(); music.next(); }
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
    if (!q) { setResults([]); setAlbumResults([]); setArtistResults([]); setPlaylistResults([]); setSearchLoading(false); setSearchError(""); return; }
    const cached = peekSearchPage(q);
    if (cached && (cached.tracks.length || cached.albums.length || cached.artists.length || cached.playlists.length)) {
      setResults(cached.tracks);
      setAlbumResults(cached.albums);
      setArtistResults(cached.artists);
      setPlaylistResults(cached.playlists);
      setSearchError(cached.error);
      setSearchLoading(false);
    } else {
      setSearchLoading(true);
      setSearchError("");
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void loadSearchPage(q).then((entry) => {
        if (!active) return;
        setResults(entry.tracks);
        setAlbumResults(entry.albums);
        setArtistResults(entry.artists);
        setPlaylistResults(entry.playlists);
        setSearchError(entry.error);
      }).finally(() => { if (active) setSearchLoading(false); });
    }, cached ? 0 : 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);
  return <PlaylistMenuProvider playlists={library.playlists} onEdit={library.edit} onDelete={(playlist) => { library.removePlaylist(playlist.id); if (page.view === "playlist" && page.playlistId === playlist.id) navigate({ view: "home" }); }} onPlay={(playlist) => { if (playlist.tracks.length) music.play(playlist.tracks[0], playlist.tracks); }} onQueue={(playlist) => music.setQueue((items) => [...items, ...playlist.tracks.filter((track, index, tracks) => !items.some((item) => item.id === track.id) && tracks.findIndex((item) => item.id === track.id) === index)])}><SongMenuProvider liked={library.liked} playlists={library.playlists} onLike={library.toggleLike} onAdd={library.add} onCreateAndAdd={(name, description, track, cover) => { const playlist = library.create(name, description, cover); library.add(playlist.id, track); }} onRemove={library.remove} onRemoveQueue={(index, track) => music.setQueue((items) => items[index]?.id === track.id ? items.filter((_, itemIndex) => itemIndex !== index) : items)} onQueue={(track) => music.setQueue((items) => items.some((item) => item.id === track.id) ? items : [...items, track])} onArtist={(track) => navigate({ view: "artist", artist: { artist: track.artist, artist_id: track.artist_id } })} onAlbum={(id) => navigate({ view: "album", albumId: id })} onRadio={(track) => navigate({ view: "mix", mix: track })} onError={music.setError}><>
    {fullscreen && <FullscreenPlayer music={music} onClose={closeFullscreen} liked={isLiked} onLike={() => { if (music.track) library.toggleLike(music.track); }} />}
    <PlayerSurface suspended={fullscreen}>
    <header className="topbar">
      <div className="history-controls"><IconButton label="Go back" disabled={pageIndex === 0} onClick={() => goHistory(pageIndex - 1)}><ChevronLeft /></IconButton><IconButton label="Go forward" disabled={pageIndex >= pages.length - 1} onClick={() => goHistory(pageIndex + 1)}><ChevronRight /></IconButton></div>
      <div className="search-area"><Tooltip label="Home"><button className="home-button" type="button" aria-label="Home" onClick={() => navigate({ view: "home" })}><HomeIcon className="home-icon" /></button></Tooltip><SearchBox onArtist={(artist) => navigate({ view: "artist", artist })} onAlbum={(albumId) => navigate({ view: "album", albumId })} onPlaylist={(playlistId) => navigate({ view: "playlist", playlistId })} results={results} loading={searchLoading} error={searchError} onSelect={(track, tracks) => music.play(track, tracks)} query={query} onChange={search} onCommit={(save) => { saveSearch.current = save; }} /></div>
      <div className="top-spacer"><Connection music={music} /><Tooltip label={music.privateListening ? "Private listening on" : "Private listening off"}><button className="privacy-trigger" type="button" aria-label={music.privateListening ? "Private listening on. Show activity on Discord" : "Private listening off. Hide activity on Discord"} aria-pressed={music.privateListening} onClick={music.togglePrivateListening}>{music.privateListening ? <LockKeyhole size={20} /> : <LockKeyholeOpen size={20} />}</button></Tooltip><Tooltip label="Settings"><button className="settings-trigger" type="button" aria-label="Settings" aria-pressed={settingsOpen} onPointerEnter={preloadSettings} onFocus={preloadSettings} onClick={() => { setSettingsClicks((value) => value + 1); setSettingsOpen(true); }}><SettingsLottieIcon clicks={settingsClicks} /></button></Tooltip></div>
    </header>
    <div className="workspace">
      <><Library width={libraryWidth} liked={library.liked} playlists={library.playlists} active={page.playlistId || page.view} onOpen={(id) => {
        if (id === "liked") navigate({ view: id });
        else navigate({ view: "playlist", playlistId: id });
      }} onCreate={(name, description, cover) => { const playlist = library.create(name, description, cover); navigate({ view: "playlist", playlistId: playlist.id }); }} /><ResizeHandle label="Resize library sidebar" min={280} max={420} value={libraryWidth} onChange={setLibraryWidth} /></>
      <section ref={homeRef} className={`home-view player-scroll ${page.view === "mix" ? "mix-mode" : ""}`}>
        {page.view === "album" && page.albumId ? <Album id={page.albumId} onBack={() => pageIndex > 0 ? goHistory(pageIndex - 1) : navigate({ view: "home" })} onPlay={music.play} onArtist={(artist) => navigate({ view: "artist", artist })} current={music.track} playing={music.playing} /> : page.view === "liked" || (page.view === "playlist" && library.playlists.some((item) => item.id === page.playlistId)) ? <Collection key={page.playlistId || page.view} kind={page.view === "liked" ? "liked" : "playlist"} playlist={library.playlists.find((item) => item.id === page.playlistId)} onArtist={(artist) => navigate({ view: "artist", artist })} tracks={page.view === "liked" ? library.liked : library.playlists.find((item) => item.id === page.playlistId)?.tracks || []} onPlay={music.play} current={music.track} playing={music.playing} /> : page.view === "playlist" && page.playlistId ? <CatalogPlaylistView id={page.playlistId} onBack={() => pageIndex > 0 ? goHistory(pageIndex - 1) : navigate({ view: "home" })} onPlay={music.play} onArtist={(artist) => navigate({ view: "artist", artist })} current={music.track} playing={music.playing} /> : page.view === "artist" && page.artist ? <Artist key={page.artist.artist_id || page.artist.artist} id={page.artist.artist_id || ""} name={page.artist.artist} onBack={() => pageIndex > 0 ? goHistory(pageIndex - 1) : navigate({ view: "home" })} onPlay={music.play} onArtist={(artist) => navigate({ view: "artist", artist })} onAlbum={(albumId) => navigate({ view: "album", albumId })} current={music.track} playing={music.playing} /> : lyricsOpen && music.track ? <Lyrics credit={music.lyricsCredit} seekVersion={music.seekVersion} lines={music.lyrics} plain={music.plainLyrics} loading={music.lyricsLoading} position={music.position} duration={music.duration} playing={music.playing && !fullscreen} track={music.track} onSeek={music.seek} /> : <Feed history={music.history} popular={music.popular} forYou={music.forYou} searchResults={results} albumResults={albumResults} artistResults={artistResults} playlistResults={playlistResults} searchLoading={searchLoading} searchError={searchError} searchQuery={query.trim()} searchCategory={page.category || "All"} onSearchCategory={setSearchCategory} onPlay={(track, tracks) => { if (query.trim()) saveSearch.current(query); music.play(track, tracks); }} mix={page.view === "mix" ? page.mix || null : null} onMix={(mix) => navigate(mix ? { view: "mix", mix } : { view: "home" })} onArtist={(artist) => { if (query.trim()) saveSearch.current(query); navigate({ view: "artist", artist }); }} onAlbum={(albumId) => { if (query.trim()) saveSearch.current(query); navigate({ view: "album", albumId }); }} onPlaylist={(playlistId) => { if (query.trim()) saveSearch.current(query); navigate({ view: "playlist", playlistId }); }} liked={library.liked} playlists={library.playlists} onLike={library.toggleLike} onAdd={library.add} current={music.track} playing={music.playing} queue={music.queue} onQueue={(track) => { if (query.trim()) saveSearch.current(query); music.setQueue((items) => items.some((item) => item.id === track.id) ? items : [...items, track]); }} />}
      </section>
      {nowPlaying && <ResizeHandle invert label="Resize now playing sidebar" min={240} max={480} value={nowPlayingWidth} onChange={setNowPlayingWidth} onDraggingChange={setResizing} />}
      <aside className={`now-playing ${nowPlaying ? "" : "collapsed"} ${resizing ? "resizing" : ""}`} style={{ width: nowPlaying ? nowPlayingWidth : 56 }}>
        {nowPlaying ? <div className="now-playing-content player-scroll">
          {music.track ? <div className="now-track">
            <div className="now-hero">
              <NowArtwork track={music.track} playing={music.playing && !fullscreen} onOpen={setMediaViewer} />
              <div className="now-heading now-heading-overlay">
                <IconButton label="Close now playing view" onClick={() => setNowPlaying(false)}><PanelRight size={16} /></IconButton>
                <strong>Now playing</strong>
              </div>
            </div>
            <SongMenuTarget className="song-menu-title" track={music.track}>
              <MarqueeText className="now-title">{music.track.title}</MarqueeText>
            </SongMenuTarget>
            <MarqueeText className="track-artist">
              <ArtistLinks track={music.track} onOpen={(artist) => navigate({ view: "artist", artist })} />
            </MarqueeText>
            <div className="now-track-rest">
              <ArtistAbout track={music.track} onArtist={(artist) => navigate({ view: "artist", artist })} />
            </div>
          </div> : <div className="now-heading"><IconButton label="Close now playing view" onClick={() => setNowPlaying(false)}><PanelRight size={16} /></IconButton><strong>Now playing</strong></div>}
        </div> : <IconButton label="Open now playing view" onClick={() => setNowPlaying(true)}><ChevronLeft size={36} /></IconButton>}
      </aside>
    </div>
    {mediaViewer && music.track && <ArtworkViewer track={music.track} videoUrl={mediaViewer.kind === "canvas" ? mediaViewer.url : undefined} playing={music.playing} onClose={() => setMediaViewer(null)} />}
    {settingsOpen && <Suspense fallback={null}><Settings onClose={() => setSettingsOpen(false)} onClearHistory={music.clearHistory} onExportHistory={music.exportHistory} autoplay={music.autoplay} onAutoplay={music.setAutoplay} repeat={music.repeat} onRepeat={music.setRepeat} discordEnabled={music.discordEnabled} onDiscordEnabled={music.toggleDiscord} track={music.track} position={music.position} duration={music.duration} /></Suspense>}
    {shortcutsOpen && <Shortcuts close={() => setShortcutsOpen(false)} />}
    {welcomeOpen && <Welcome close={() => setWelcomeOpen(false)} />}
    <PlayerAlert message={music.error || library.error} onDismiss={() => { music.setError(""); library.clearError(); }} />
    <PlayerBar onFullscreen={openFullscreen} music={music} lyricsOpen={lyricsOpen} queueOpen={queueOpen} miniOpen={miniOpen} onLyrics={toggleLyrics} onQueue={() => setQueueOpen(!queueOpen)} onCloseQueue={() => setQueueOpen(false)} onMini={toggleMini} onArtist={(artist) => navigate({ view: "artist", artist })} onArtwork={() => setMediaViewer({ kind: "artwork" })} liked={isLiked} onLike={() => { if (music.track) library.toggleLike(music.track); }} />
  </PlayerSurface></></SongMenuProvider></PlaylistMenuProvider>;
}

