import { Classic } from "../../../shared/ui/Classic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Clock3, Compass, History, ListPlus, MoreVertical, Play, Radio, Search, Shuffle } from "lucide-react";
import { Music, type CatalogAlbum, type CatalogArtist, type CatalogPlaylist, type Track } from "../../../mygo";
import { SearchResults, type SearchCategory } from "../search/SearchResults";
import { Artwork, artworkURL, hasArtworkURL, preloadArtworkSource } from "../../../shared/ui/Artwork";
import { PlayingSpectrum } from "../../../shared/ui/PlayingSpectrum";
import { HomeHeroCarousel } from "./HomeHeroCarousel";
import type { Playlist } from "../library/useLibrary";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { ArtistLinks } from "../shared/ArtistLinks";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { extractArtworkTheme, useArtworkTheme } from "../shared/artworkColor";
import { trackDurationLabel } from "../shared/trackDuration";
import { useSongMenu } from "../shared/SongMenu";
import { PlayerAlert } from "../shared/PlayerAlert";

const MORNING_GREETINGS = [
  "Hey, good morning.",
  "Sleep well?",
  "Look who's awake.",
  "Morning, sleepyhead.",
  "What's on your mind?",
  "A little music to wake up?",
];

const AFTERNOON_GREETINGS = [
  "Hey, you’re back.",
  "How's your day been?",
  "Missed your music?",
  "Taking a little break?",
  "There you are.",
  "What are you in the mood for?",
];

const EVENING_GREETINGS = [
  "Hey, how was your day?",
  "You made it through today.",
  "Still awake?",
  "A little time for yourself?",
  "It's been a long day, huh?",
  "Stay for a song or two?",
];

function homeGreeting(now = new Date()) {
  const hour = now.getHours();
  const greetings =
    hour >= 5 && hour < 12 ? MORNING_GREETINGS
      : hour >= 12 && hour < 17 ? AFTERNOON_GREETINGS
        : EVENING_GREETINGS;
  const day = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000);
  return greetings[(day - 1 + greetings.length) % greetings.length];
}

function homeDateLabel(now = new Date()) {
  return now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function Rows({
  tracks,
  onPlay,
  onArtist,
  onQueue,
  current,
  queue,
  rowRef,
  liked,
  playlists,
  onLike,
  onAdd,
  extra,
  onRemoveTrack,
  edgeFade,
  playing = false,
}: {
  liked: Track[];
  playlists: Playlist[];
  onLike: (track: Track) => void;
  onAdd: (id: string, track: Track) => void;
  tracks: Track[];
  onPlay: (track: Track, queue: Track[]) => void;
  onArtist: (track: Track) => void;
  onQueue: (track: Track) => void;
  current: Track | null;
  queue: Track[];
  rowRef?: RefObject<HTMLDivElement | null>;
  extra?: ReactNode;
  onRemoveTrack?: (id: string) => void;
  edgeFade?: boolean;
  playing?: boolean;
}) {
  const openSongMenu = useSongMenu();
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [fade, setFade] = useState({ left: false, right: false });
  const handleFail = useCallback((trackId: string) => {
    setFailedIds((prev) => new Set(prev).add(trackId));
    onRemoveTrack?.(trackId);
  }, [onRemoveTrack]);

  useEffect(() => {
    const onFailed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const bad = tracks.find((t) => t.album_art_url === detail?.src || artworkURL(t.album_art_url) === detail?.url || artworkURL(t.album_art_url, 288) === detail?.url);
      if (bad) {
        handleFail(bad.id);
      }
    };
    window.addEventListener("wisewave-artwork-failed", onFailed);
    return () => window.removeEventListener("wisewave-artwork-failed", onFailed);
  }, [tracks, handleFail]);

  const validTracks = tracks.filter((track) => track && track.id && hasArtworkURL(track.album_art_url) && !failedIds.has(track.id));

  useEffect(() => {
    if (!edgeFade) {
      setFade({ left: false, right: false });
      return;
    }
    const row = rowRef?.current;
    if (!row) {
      setFade({ left: false, right: false });
      return;
    }
    const update = () => setFade({ left: row.scrollLeft > 1, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 1 });
    const observer = new ResizeObserver(update);
    observer.observe(row);
    row.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      row.removeEventListener("scroll", update);
    };
  }, [edgeFade, rowRef, validTracks.length]);

  return (
    <div className={edgeFade ? `track-row track-row-fade${fade.left ? " fade-left" : ""}${fade.right ? " fade-right" : ""}` : "track-row"} ref={rowRef}>
      {validTracks.map((track) => (
        <article className="track-card" key={track.id}>
          <div
            className="track-art-wrap"
            onPointerLeave={(event) => {
              const focused = document.activeElement;
              if (focused instanceof HTMLElement && event.currentTarget.contains(focused)) focused.blur();
            }}
          >
            <Artwork
              className="track-art"
              src={track.album_art_url}
              size={144}
              lazy
              onFail={() => handleFail(track.id)}
            />
            <PlayingSpectrum active={current?.id === track.id} playing={playing} size={32} placement="corner" />
            <Tooltip className="card-queue" label={current ? "Add to queue" : "Play now"}>
              <button
                className="card-action"
                type="button"
                aria-label={current ? `Add ${track.title} to queue` : `Play ${track.title}`}
                onClick={() => (current ? onQueue(track) : onPlay(track, validTracks))}
              >
                <ListPlus size={24} />
              </button>
            </Tooltip>
            <Tooltip className="card-play" label="Play now">
              <button
                className="card-action"
                type="button"
                aria-label={`Play ${track.title} now`}
                onClick={() => onPlay(track, validTracks)}
              >
                <Play size={16} fill="currentColor" />
              </button>
            </Tooltip>
          </div>
          <button className="card-title song-menu-title" type="button" onContextMenu={(event) => openSongMenu(event, track)} onClick={() => onPlay(track, validTracks)}>
            <MarqueeText className="track-title">{track.title}</MarqueeText>
          </button>
          <MarqueeText className="track-artist" title={track.artist}>
            <ArtistLinks track={track} onOpen={onArtist} />
          </MarqueeText>
        </article>
      ))}
      {extra}
    </div>
  );
}

function chunkTracks(tracks: Track[], size: number) {
  const chunks: Track[][] = [];
  for (let index = 0; index < tracks.length; index += size) chunks.push(tracks.slice(index, index + size));
  return chunks;
}

function QuickPicks({
  tracks,
  onPlay,
  onArtist,
  current,
  playing = false,
}: {
  tracks: Track[];
  onPlay: (track: Track, queue: Track[]) => void;
  onArtist: (track: Track) => void;
  current: Track | null;
  playing?: boolean;
}) {
  const openSongMenu = useSongMenu();
  const rowRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ left: false, right: false });
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const validTracks = tracks.filter((track) => track?.id && hasArtworkURL(track.album_art_url) && !failedIds.has(track.id));
  const columns = chunkTracks(validTracks, 3);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) { setAvailable({ left: false, right: false }); return; }
    const update = () => setAvailable({ left: row.scrollLeft > 1, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 1 });
    const observer = new ResizeObserver(update);
    observer.observe(row);
    row.addEventListener("scroll", update, { passive: true });
    update();
    return () => { observer.disconnect(); row.removeEventListener("scroll", update); };
  }, [validTracks.length]);

  const scroll = (direction: number) => rowRef.current?.scrollBy({ left: direction * rowRef.current.clientWidth * 0.8, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });

  return (
    <section className="feed quick-picks">
      <div className="feed-heading">
        <div className="feed-heading-copy">
          <h2>For You</h2>
          <span>More of what you love</span>
        </div>
        <div className="quick-picks-controls">
          <button className="quick-picks-play" type="button" disabled={!validTracks.length} onClick={() => { if (validTracks[0]) onPlay(validTracks[0], validTracks); }}>
            <Play size={16} fill="currentColor" />
            Play all
          </button>
          <div className="row-navigation">
            <button type="button" aria-label="Scroll For You left" disabled={!available.left} onClick={() => scroll(-1)}><ChevronLeft size={20} /></button>
            <button type="button" aria-label="Scroll For You right" disabled={!available.right} onClick={() => scroll(1)}><ChevronRight size={20} /></button>
          </div>
        </div>
      </div>
      {validTracks.length ? (
        <div className={`quick-picks-row${available.left ? " fade-left" : ""}${available.right ? " fade-right" : ""}`} ref={rowRef}>
          {columns.map((group, columnIndex) => (
            <div className="quick-picks-column" key={`for-you-${columnIndex}-${group[0]?.id || columnIndex}`}>
              {group.map((track) => (
                <article
                  className="quick-pick-card"
                  key={track.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Play ${track.title}`}
                  onClick={() => onPlay(track, validTracks)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onPlay(track, validTracks);
                    }
                  }}
                  onContextMenu={(event) => openSongMenu(event, track)}
                >
                  <span className="quick-pick-art-wrap">
                    <Artwork className="quick-pick-art" src={track.album_art_url} size={56} lazy onFail={() => setFailedIds((prev) => new Set(prev).add(track.id))} />
                    <PlayingSpectrum active={current?.id === track.id} playing={playing} size={28} />
                    <span className="quick-pick-play-overlay" aria-hidden="true">
                      <Play size={16} fill="currentColor" />
                    </span>
                  </span>
                  <span className="quick-pick-meta">
                    <button
                      className="quick-pick-title song-menu-title"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPlay(track, validTracks);
                      }}
                      onContextMenu={(event) => {
                        event.stopPropagation();
                        openSongMenu(event, track);
                      }}
                    >
                      <MarqueeText>{track.title}</MarqueeText>
                    </button>
                    <span className="quick-pick-artist" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                      <MarqueeText title={track.artist}>
                        <ArtistLinks track={track} onOpen={onArtist} />
                      </MarqueeText>
                    </span>
                  </span>
                  <Tooltip label="More">
                    <button
                      className="quick-pick-more"
                      type="button"
                      aria-label={`More options for ${track.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        openSongMenu(event, track);
                      }}
                    >
                      <MoreVertical size={18} />
                    </button>
                  </Tooltip>
                </article>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="feed-empty">
          <Radio size={28} />
          <strong>No recommendations yet</strong>
          <span>Listen to or like songs to shape your feed.</span>
        </div>
      )}
    </section>
  );
}

function FeedSection({ title, description, count, children, empty, onNearEnd, noNav, actions }: { title: string; description: string; count: number; children: (ref: RefObject<HTMLDivElement | null>) => ReactNode; empty: ReactNode; onNearEnd?: () => void; noNav?: boolean; actions?: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ left: false, right: false });
  useEffect(() => {
    const row = rowRef.current;
    if (!row) { setAvailable({ left: false, right: false }); return; }
    const update = () => {
      if (!noNav) setAvailable({ left: row.scrollLeft > 1, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 1 });
      if (onNearEnd && row.scrollLeft + row.clientWidth >= row.scrollWidth - 600) {
        onNearEnd();
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(row);
    row.addEventListener("scroll", update, { passive: true });
    update();
    return () => { observer.disconnect(); row.removeEventListener("scroll", update); };
  }, [count, onNearEnd, noNav]);
  const scroll = (direction: number) => rowRef.current?.scrollBy({ left: direction * rowRef.current.clientWidth * .8, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  return <section className="feed"><div className="feed-heading"><div className="feed-heading-copy"><h2>{title}</h2><span>{description}</span></div>{(actions || !noNav) && <div className="feed-heading-actions">{actions}{!noNav && <div className="row-navigation"><button type="button" aria-label={`Scroll ${title} left`} disabled={!available.left} onClick={() => scroll(-1)}><ChevronLeft size={20} /></button><button type="button" aria-label={`Scroll ${title} right`} disabled={!available.right} onClick={() => scroll(1)}><ChevronRight size={20} /></button></div>}</div>}</div>{count ? children(rowRef) : empty}</section>;
}

const mixCache = new Map<string, Track[]>();
const mixRequests = new Map<string, Promise<Track[]>>();

function loadMix(track: Track) {
  const cached = mixCache.get(track.id);
  if (cached) return Promise.resolve(cached);
  const pending = mixRequests.get(track.id);
  if (pending) return pending;
  const request = Music.related(track.id).then((tracks) => {
    const items = [track, ...tracks.filter((item) => item.id !== track.id)];
    mixCache.set(track.id, items);
    return items;
  }).finally(() => mixRequests.delete(track.id));
  mixRequests.set(track.id, request);
  return request;
}

const DISCOVER_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const DISCOVER_STORAGE_KEY = "wisewave-discover-cache";

let discoverMemoryCache: {
  tracks: Track[];
  seen: Set<string>;
  timestamp: number;
  seedIndex: number;
} | null = null;

function getDiscoverCache(): { tracks: Track[]; seen: Set<string>; timestamp: number; seedIndex: number } {
  if (discoverMemoryCache) {
    return discoverMemoryCache;
  }
  try {
    const raw = localStorage.getItem(DISCOVER_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.tracks) && data.tracks.length > 0) {
        const validTracks = data.tracks.filter((t: Track) => t && t.id && hasArtworkURL(t.album_art_url));
        const seen = new Set<string>(validTracks.map((t: Track) => t.id).filter(Boolean));
        discoverMemoryCache = {
          tracks: validTracks,
          seen,
          timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
          seedIndex: typeof data.seedIndex === "number" ? data.seedIndex : 0,
        };
        return discoverMemoryCache;
      }
    }
  } catch {}

  discoverMemoryCache = {
    tracks: [],
    seen: new Set<string>(),
    timestamp: 0,
    seedIndex: 0,
  };
  return discoverMemoryCache;
}

function saveDiscoverCache(tracks: Track[], seedIndex: number, timestamp: number) {
  const seen = new Set<string>(tracks.map((t) => t.id).filter(Boolean));
  discoverMemoryCache = {
    tracks,
    seen,
    timestamp,
    seedIndex,
  };
  try {
    localStorage.setItem(
      DISCOVER_STORAGE_KEY,
      JSON.stringify({
        tracks: tracks.slice(0, 100),
        timestamp,
        seedIndex,
      })
    );
  } catch {}
}

export function Feed({ history, popular, forYou, searchResults, albumResults = [], artistResults = [], playlistResults = [], searchQuery, searchCategory, onSearchCategory, searchLoading, searchError, onPlay, mix, onMix, onArtist, onAlbum, onPlaylist, onQueue, current, queue, liked, playlists, onLike, onAdd, playing = false }: { liked: Track[]; playlists: Playlist[]; onLike: (track: Track) => void; onAdd: (id: string, track: Track) => void; onArtist: (track: { artist: string; artist_id?: string }) => void; onAlbum?: (albumId: string) => void; onPlaylist?: (playlistId: string) => void; onQueue: (track: Track) => void; current: Track | null; queue: Track[]; mix: Track | null; onMix: (track: Track | null) => void; history: Track[]; popular: Track[]; forYou: Track[]; searchResults: Track[]; albumResults?: CatalogAlbum[]; artistResults?: CatalogArtist[]; playlistResults?: CatalogPlaylist[]; searchQuery: string; searchCategory: SearchCategory; onSearchCategory: (category: SearchCategory) => void; searchLoading?: boolean; searchError?: string; onPlay: (track: Track, queue: Track[]) => void; playing?: boolean }) {
  const openSongMenu = useSongMenu();
  const [mixSeedTracks, setMixSeedTracks] = useState<Track[]>(() => history.slice(0, 16));
  useEffect(() => {
    setMixSeedTracks(history.slice(0, 16));
  }, [forYou]);
  const mixes = useMemo(() => {
    const seeds = Array.from(new Map([...mixSeedTracks, ...forYou, ...popular].filter((track) => track.id && hasArtworkURL(track.album_art_url)).map((track) => [track.id, track])).values());
    const artists = new Set<string>();
    const unique = seeds.filter((track) => {
      const artist = track.artist.toLowerCase().trim();
      if (artists.has(artist)) return false;
      artists.add(artist);
      return true;
    });
    const ids = new Set(unique.map((track) => track.id));
    return (unique.length >= 16 ? unique : [...unique, ...seeds.filter((track) => !ids.has(track.id))]).slice(0, 16);
  }, [mixSeedTracks, forYou, popular]);
  const [failedMixIds, setFailedMixIds] = useState<Set<string>>(() => new Set());
  const mixArtworkUrls = mixes.map((track) => artworkURL(track.album_art_url, 256)).filter(Boolean).join("\n");

  useEffect(() => {
    let active = true;
    const urls = mixArtworkUrls.split("\n").filter(Boolean);
    let index = 0;
    const warm = async () => {
      while (active && index < urls.length) {
        const url = urls[index++];
        await extractArtworkTheme(url);
      }
    };
    const timer = window.setTimeout(() => { void warm(); void warm(); }, 500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [mixArtworkUrls]);

  useEffect(() => {
    const onFailed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const bad = mixes.find((t) => t.album_art_url === detail?.src || artworkURL(t.album_art_url) === detail?.url || artworkURL(t.album_art_url, 560) === detail?.url);
      if (bad) {
        setFailedMixIds((prev) => new Set(prev).add(bad.id));
      }
    };
    window.addEventListener("wisewave-artwork-failed", onFailed);
    return () => window.removeEventListener("wisewave-artwork-failed", onFailed);
  }, [mixes]);

  const mixTheme = useArtworkTheme(mix);

  const cachedDiscover = getDiscoverCache();
  const isDiscoverExpired = Date.now() - cachedDiscover.timestamp >= DISCOVER_REFRESH_INTERVAL_MS;
  const initialDiscoverTracks = !isDiscoverExpired && cachedDiscover.tracks.length > 0 ? cachedDiscover.tracks : [];

  const [discoverTracks, setDiscoverTracks] = useState<Track[]>(initialDiscoverTracks);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const discoverLoadingRef = useRef(false);
  const discoverSeenRef = useRef<Set<string>>(new Set(initialDiscoverTracks.length > 0 ? cachedDiscover.seen : []));
  const discoverSeedIndexRef = useRef(initialDiscoverTracks.length > 0 ? cachedDiscover.seedIndex : 0);

  const historyRef = useRef(history);
  historyRef.current = history;
  const likedRef = useRef(liked);
  likedRef.current = liked;
  const forYouRef = useRef(forYou);
  forYouRef.current = forYou;
  const popularRef = useRef(popular);
  popularRef.current = popular;
  const discoverTracksRef = useRef(discoverTracks);
  discoverTracksRef.current = discoverTracks;

  const hasValidArt = (t: Track) => Boolean(t && t.id && hasArtworkURL(t.album_art_url));

  const removeDiscoverTrack = useCallback((trackId: string) => {
    setDiscoverTracks((prev) => {
      const next = prev.filter((t) => t.id !== trackId);
      const cache = getDiscoverCache();
      saveDiscoverCache(next, discoverSeedIndexRef.current, cache.timestamp || Date.now());
      return next;
    });
  }, []);

  const loadMoreDiscover = useCallback(async () => {
    if (discoverLoadingRef.current) return;
    discoverLoadingRef.current = true;
    setDiscoverLoading(true);
    try {
      const allSeeds = [
        ...discoverTracksRef.current.slice(-16),
        ...historyRef.current,
        ...likedRef.current,
        ...forYouRef.current,
        ...popularRef.current,
      ].filter((t) => t && t.id && !t.id.startsWith("local:"));

      let newTracks: Track[] = [];

      if (allSeeds.length > 0) {
        const seedIndex = discoverSeedIndexRef.current % allSeeds.length;
        discoverSeedIndexRef.current += 1;
        const seed = allSeeds[seedIndex];
        try {
          const related = await Music.related(seed.id);
          newTracks = related.filter((t) => t.id && !discoverSeenRef.current.has(t.id) && hasValidArt(t));
        } catch {}
      }

      if (newTracks.length < 6 && allSeeds.length > 1) {
        const nextSeedIndex = discoverSeedIndexRef.current % allSeeds.length;
        discoverSeedIndexRef.current += 1;
        const nextSeed = allSeeds[nextSeedIndex];
        try {
          const moreRelated = await Music.related(nextSeed.id);
          const unseen = moreRelated.filter((t) => t.id && !discoverSeenRef.current.has(t.id) && hasValidArt(t));
          newTracks = [...newTracks, ...unseen];
        } catch {}
      }

      if (newTracks.length < 6) {
        const unseenPopular = popularRef.current.filter((t) => t.id && !discoverSeenRef.current.has(t.id) && hasValidArt(t));
        if (unseenPopular.length > 0) {
          newTracks = [...newTracks, ...unseenPopular];
        }
      }

      if (newTracks.length < 6) {
        try {
          const fallbackQueries = ["popular hits", "trending songs", "new music pop", "chill vibes", "indie favorites"];
          const query = fallbackQueries[discoverSeedIndexRef.current % fallbackQueries.length];
          discoverSeedIndexRef.current += 1;
          const searchTracks = await Music.search(query);
          const unseenSearch = searchTracks.filter((t) => t.id && !discoverSeenRef.current.has(t.id) && hasValidArt(t));
          newTracks = [...newTracks, ...unseenSearch];
        } catch {}
      }

      if (newTracks.length > 0) {
        for (const t of newTracks) {
          discoverSeenRef.current.add(t.id);
        }
        const updated = [...discoverTracksRef.current, ...newTracks];
        setDiscoverTracks(updated);
        const currentCache = getDiscoverCache();
        saveDiscoverCache(updated, discoverSeedIndexRef.current, currentCache.timestamp || Date.now());
      }
    } finally {
      discoverLoadingRef.current = false;
      setDiscoverLoading(false);
    }
  }, []);

  const refreshDiscover = useCallback(async () => {
    if (discoverLoadingRef.current) return;
    discoverLoadingRef.current = true;
    setDiscoverLoading(true);
    try {
      discoverSeenRef.current = new Set();
      discoverSeedIndexRef.current = 0;

      const allSeeds = [
        ...historyRef.current,
        ...likedRef.current,
        ...forYouRef.current,
        ...popularRef.current,
      ].filter((t) => t && t.id && !t.id.startsWith("local:"));

      let newTracks: Track[] = [];

      if (allSeeds.length > 0) {
        const seedIndex = discoverSeedIndexRef.current % allSeeds.length;
        discoverSeedIndexRef.current += 1;
        const seed = allSeeds[seedIndex];
        try {
          const related = await Music.related(seed.id);
          newTracks = related.filter((t) => t.id && !discoverSeenRef.current.has(t.id) && hasValidArt(t));
        } catch {}
      }

      if (newTracks.length < 10 && allSeeds.length > 1) {
        const nextSeedIndex = discoverSeedIndexRef.current % allSeeds.length;
        discoverSeedIndexRef.current += 1;
        const nextSeed = allSeeds[nextSeedIndex];
        try {
          const moreRelated = await Music.related(nextSeed.id);
          const unseen = moreRelated.filter((t) => t.id && !discoverSeenRef.current.has(t.id) && hasValidArt(t));
          newTracks = [...newTracks, ...unseen];
        } catch {}
      }

      if (newTracks.length < 10) {
        const unseenPopular = popularRef.current.filter((t) => t.id && !discoverSeenRef.current.has(t.id) && hasValidArt(t));
        if (unseenPopular.length > 0) {
          newTracks = [...newTracks, ...unseenPopular];
        }
      }

      if (newTracks.length < 10) {
        try {
          const fallbackQueries = ["popular hits", "trending songs", "new music pop", "chill vibes", "indie favorites"];
          const query = fallbackQueries[discoverSeedIndexRef.current % fallbackQueries.length];
          discoverSeedIndexRef.current += 1;
          const searchTracks = await Music.search(query);
          const unseenSearch = searchTracks.filter((t) => t.id && !discoverSeenRef.current.has(t.id) && hasValidArt(t));
          newTracks = [...newTracks, ...unseenSearch];
        } catch {}
      }

      if (newTracks.length > 0) {
        for (const t of newTracks) {
          discoverSeenRef.current.add(t.id);
        }
        const now = Date.now();
        setDiscoverTracks(newTracks);
        saveDiscoverCache(newTracks, discoverSeedIndexRef.current, now);
      }
    } finally {
      discoverLoadingRef.current = false;
      setDiscoverLoading(false);
    }
  }, []);

  useEffect(() => {
    if (discoverTracks.length === 0) {
      void refreshDiscover();
    }
  }, [discoverTracks.length, refreshDiscover]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cache = getDiscoverCache();
      if (Date.now() - cache.timestamp >= DISCOVER_REFRESH_INTERVAL_MS) {
        void refreshDiscover();
      }
    }, 60 * 1000);

    return () => window.clearInterval(timer);
  }, [refreshDiscover]);


  const [mixTracks, setMixTracks] = useState<Track[]>(() => {
    if (mix && mixCache.has(mix.id)) {
      return mixCache.get(mix.id)!;
    }
    return [];
  });
  const [mixError, setMixError] = useState("");
  const [mixLoading, setMixLoading] = useState(() => Boolean(mix && !mixCache.has(mix.id)));
  const [mixQuery, setMixQuery] = useState("");
  const [mixRetry, setMixRetry] = useState(0);

  useEffect(() => {
    if (!mixes.length) return;
    let active = true;
    let index = 0;
    const warm = async () => {
      while (active && index < mixes.length) {
        const track = mixes[index++];
        try {
          const items = await loadMix(track);
          if (active) items.slice(0, 12).forEach((item) => preloadArtworkSource(item.album_art_url, 40));
        } catch (error) {
          console.warn("Could not preload daily mix", error);
        }
      }
    };
    const timer = window.setTimeout(() => { void warm(); void warm(); }, 500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [mixes.map((m) => m.id).join(",")]);

  useEffect(() => {
    if (!mix) return;
    if (mixRetry === 0 && mixCache.has(mix.id)) {
      setMixTracks(mixCache.get(mix.id)!);
      setMixLoading(false);
      setMixError("");
      setMixQuery("");
      return;
    }
    let active = true;
    if (mixRetry > 0) mixCache.delete(mix.id);
    setMixTracks([]); setMixError(""); setMixLoading(true); setMixQuery("");
    loadMix(mix).then((full) => {
      if (active) setMixTracks(full);
    }).catch(() => {
      if (active) setMixError("This mix could not be loaded.");
    }).finally(() => {
      if (active) setMixLoading(false);
    });
    return () => { active = false; };
  }, [mix, mixRetry]);
  if (searchQuery) return <SearchResults key={searchQuery} query={searchQuery} category={searchCategory} onCategory={onSearchCategory} loading={searchLoading} error={searchError} tracks={searchResults} albums={albumResults} artists={artistResults} playlists={playlistResults} liked={liked} current={current} playing={playing} onPlay={onPlay} onLike={onLike} onQueue={onQueue} onArtist={onArtist} onAlbum={onAlbum || (() => {})} onPlaylist={onPlaylist || (() => {})} />;
  if (mix) {
    const visible = mixTracks.filter((track) => `${track.title} ${track.artist}`.toLowerCase().includes(mixQuery.trim().toLowerCase()));
    const shuffle = () => {
      const shuffled = [...mixTracks];
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      if (shuffled.length) onPlay(shuffled[0], shuffled);
    };
    return (
      <div className="player-scroll view-enter collection mix-view">
        <div
          className="collection-header mix-header"
          style={{ background: mixTheme.gradient }}
        >
          <div className="collection-heading">
            <Artwork className="collection-cover" src={mix.album_art_url} size={176} />
            <div className="collection-heading-meta">
              <p className="collection-header-category">Made for you</p>
              <h1 className="collection-header-title">Daily Mix</h1>
              <p className="collection-header-desc">{mix.artist} and more music to get lost in.</p>
              <p className="collection-header-stats">
                {mixLoading ? "Finding your next favorites…" : `${mixTracks.length} ${mixTracks.length === 1 ? "song" : "songs"}`}
              </p>
            </div>
          </div>
        </div>

        <div className="collection-content">
          <div className="collection-toolbar">
            <div className="mix-toolbar-left">
              <button
                className="collection-play-btn"
                type="button"
                aria-label="Play daily mix"
                disabled={!mixTracks.length || mixLoading}
                onClick={() => onPlay(mixTracks[0], mixTracks)}
              >
                <Play size={24} fill="currentColor" />
              </button>
              <button
                className="detail-icon"
                type="button"
                aria-label="Shuffle daily mix"
                disabled={!mixTracks.length || mixLoading}
                onClick={shuffle}
              >
                <Shuffle size={22} />
              </button>
            </div>

            <label className="collection-search-label">
              <Search className="search-icon" size={16} />
              <input
                type="search"
                aria-label="Search in daily mix"
                placeholder="Search in this mix"
                value={mixQuery}
                onChange={(event) => setMixQuery(event.target.value)}
              />
            </label>
          </div>

          {mixError ? (
            <div className="detail-empty">
              <PlayerAlert message={mixError} onDismiss={() => {}} action={{ label: "Retry", onClick: () => setMixRetry((value) => value + 1) }} />
              <button className="artist-secondary" type="button" onClick={() => setMixRetry((value) => value + 1)}>
                Try again
              </button>
            </div>
          ) : mixLoading ? (
            <p className="detail-empty loading-state" role="status">
              <Classic />Loading your mix…
            </p>
          ) : (
            <>
              <div className="collection-table-header">
                <span className="col-num-header">#</span>
                <span className="collection-grid-cols">
                  <span className="col-title-header">Title</span>
                  <span className="col-author-header">Artist</span>
                  <Clock3 className="col-duration-icon" size={16} />
                </span>
              </div>

              <div className="collection-songs-list">
                {visible.map((track, index) => (
                  <div
                    className="collection-song-row"
                    key={track.id}
                    onClick={() => onPlay(track, mixTracks)}
                  >
                    <span className="song-index-num">{index + 1}</span>

                    <span className="collection-grid-cols">
                      <span className="song-title-cell">
                        <span className="song-artwork-container">
                          <Artwork
                            className="song-artwork-img"
                            src={track.album_art_url}
                            size={40}
                            lazy
                          />
                          <PlayingSpectrum active={current?.id === track.id} playing={playing} size={24} />
                          <span className="song-play-hover-overlay">
                            <Play size={16} fill="#ffffff" />
                          </span>
                        </span>
                        <span className="song-title-wrapper">
                          <button
                            type="button"
                            className="song-main-title song-menu-title"
                            onContextMenu={(event) => openSongMenu(event, track)}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPlay(track, mixTracks);
                            }}
                          >
                            <MarqueeText>{track.title}</MarqueeText>
                          </button>
                          <small className="song-sub-label">{track.album || "Daily Mix"}<span className="song-compact-artist"> · <ArtistLinks track={track} onOpen={onArtist} /></span></small>
                        </span>
                      </span>

                      <span className="song-author-cell">
                        <MarqueeText className="song-author-marquee">
                          <ArtistLinks track={track} onOpen={onArtist} />
                        </MarqueeText>
                      </span>
                      <span className="song-duration-cell">
                        <span className="duration-digits">{trackDurationLabel(track)}</span>
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              {!visible.length && (
                <p className="detail-empty">
                  {mixQuery ? "No songs match your search." : "No songs are available for this mix."}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }
  const heroTracks = Array.from(
    new Map([...forYou, ...popular, ...history].filter((track) => track?.id && hasArtworkURL(track.album_art_url)).map((track) => [track.id, track])).values(),
  ).slice(0, 24);

  return <>
    <div className="home-hero-wrap">
      <header className="home-hero-greeting">
        <h2 className="home-hero-hello">{homeGreeting()}</h2>
        <p className="home-hero-date">{homeDateLabel()}</p>
      </header>
      <HomeHeroCarousel tracks={heroTracks} onPlay={onPlay} current={current} playing={playing} />
    </div>
    <FeedSection
      title="Discover"
      description="A mix shaped around your listening"
      count={discoverTracks.length}
      onNearEnd={loadMoreDiscover}
      actions={
        <button
          className="quick-picks-play"
          type="button"
          disabled={!discoverTracks.length}
          onClick={() => {
            const playable = discoverTracks.filter((track) => track?.id && hasArtworkURL(track.album_art_url));
            if (playable[0]) onPlay(playable[0], playable);
          }}
        >
          <Play size={16} fill="currentColor" />
          Play all
        </button>
      }
      empty={
        discoverLoading ? (
          <div className="feed-empty" role="status">
            <Classic />
            <strong>Finding music to discover…</strong>
          </div>
        ) : (
          <div className="feed-empty">
            <Compass size={28} />
            <strong>Nothing to discover yet</strong>
            <span>Play a few songs to help discover your sound.</span>
          </div>
        )
      }
    >
      {(ref) => (
        <Rows
          liked={liked}
          playlists={playlists}
          onLike={onLike}
          onAdd={onAdd}
          onArtist={onArtist}
          onQueue={onQueue}
          current={current}
          queue={queue}
          tracks={discoverTracks}
          onPlay={onPlay}
          rowRef={ref}
          onRemoveTrack={removeDiscoverTrack}
          edgeFade
          playing={playing}
          extra={
            discoverLoading ? (
              <div
                className="track-card"
                style={{
                  width: 160,
                  flex: "0 0 160px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 160,
                  opacity: 0.6,
                }}
              >
                <Classic />
              </div>
            ) : null
          }
        />
      )}
    </FeedSection>
    <FeedSection title="Recents" description="Your latest listens" count={history.length} empty={<div className="feed-empty"><History size={28} /><strong>Nothing here yet</strong><span>Songs you listen to will show up here.</span></div>}>{(ref) => <Rows liked={liked} playlists={playlists} onLike={onLike} onAdd={onAdd} onArtist={onArtist} onQueue={onQueue} current={current} queue={queue} tracks={history} onPlay={onPlay} rowRef={ref} playing={playing} />}</FeedSection>
    <FeedSection title="Daily Mix" description="A fresh mix of your favorites" count={mixes.length} empty={<div className="feed-empty"><Radio size={28} /><strong>No mixes yet</strong><span>Listen to a few songs to get your daily mix.</span></div>}>{(ref) => {
      const visibleMixes = mixes.filter((track) => hasArtworkURL(track.album_art_url) && !failedMixIds.has(track.id));
      const pages = chunkTracks(visibleMixes, 8);
      return (
        <div className="daily-mix-row" ref={ref}>
          {pages.map((page, pageIndex) => (
            <div className="daily-mix-grid" key={`daily-mix-page-${pageIndex}`}>
              {page.map((track, index) => (
                <button className="mix-card" key={track.id} type="button" onClick={() => onMix(track)}>
                  <Artwork src={track.album_art_url} size={280} lazy onFail={() => setFailedMixIds((prev) => new Set(prev).add(track.id))} />
                  <span>Daily Mix {pageIndex * 8 + index + 1}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      );
    }}</FeedSection>
    <QuickPicks tracks={forYou.length ? forYou : popular} onPlay={onPlay} onArtist={onArtist} current={current} playing={playing} />
  </>;
}
