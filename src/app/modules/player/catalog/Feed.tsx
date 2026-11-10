import { Classic } from "../../../shared/ui/Classic";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Clock3, Heart, History, ListPlus, Play, Plus, Search, Shuffle } from "lucide-react";
import { Music, type CatalogAlbum, type CatalogArtist, type Track } from "../../../mygo";
import { SearchResults, type SearchCategory } from "../search/SearchResults";
import { Artwork, artworkURL, hasArtworkURL } from "../../../shared/ui/Artwork";
import type { Playlist } from "../library/useLibrary";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { ArtistLinks } from "../shared/ArtistLinks";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { useArtworkTheme } from "../shared/artworkColor";
import { useSongMenu } from "../shared/SongMenu";

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
}) {
  const openSongMenu = useSongMenu();
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
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

  return (
    <div className="track-row" ref={rowRef}>
      {validTracks.map((track) => (
        <article className="track-card" key={track.id}>
          <div className="track-art-wrap">
            <Artwork
              className="track-art"
              src={track.album_art_url}
              size={144}
              lazy
              onFail={() => handleFail(track.id)}
            />
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
          <div className="card-library">
            {playlists.length > 0 && (
              <label aria-label="Add to playlist">
                <Plus size={15} />
                <select
                  aria-label={`Add ${track.title} to playlist`}
                  value=""
                  onChange={(event) => {
                    if (event.target.value) onAdd(event.target.value, track);
                  }}
                >
                  <option value="">Add to playlist</option>
                  {playlists.map((playlist) => (
                    <option value={playlist.id} key={playlist.id}>
                      {playlist.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
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

function FeedSection({ title, description, count, children, empty, onNearEnd, noNav }: { title: string; description: string; count: number; children: (ref: RefObject<HTMLDivElement | null>) => ReactNode; empty: ReactNode; onNearEnd?: () => void; noNav?: boolean }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ left: false, right: false });
  useEffect(() => {
    if (noNav) return;
    const row = rowRef.current;
    if (!row) { setAvailable({ left: false, right: false }); return; }
    const update = () => {
      setAvailable({ left: row.scrollLeft > 1, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 1 });
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
  return <section className="feed"><div className="feed-heading"><h2>{title}</h2><div className="row-navigation"><span>{description}</span>{!noNav && (<><button type="button" aria-label={`Scroll ${title} left`} disabled={!available.left} onClick={() => scroll(-1)}><ChevronLeft size={20} /></button><button type="button" aria-label={`Scroll ${title} right`} disabled={!available.right} onClick={() => scroll(1)}><ChevronRight size={20} /></button></>)}</div></div>{count ? children(rowRef) : empty}</section>;
}

const mixCache = new Map<string, Track[]>();

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

export function Feed({ history, popular, forYou, searchResults, albumResults = [], artistResults = [], searchQuery, searchCategory, onSearchCategory, searchLoading, searchError, onPlay, mix, onMix, onArtist, onAlbum, onPlaylist, onQueue, current, queue, liked, playlists, onLike, onAdd }: { liked: Track[]; playlists: Playlist[]; onLike: (track: Track) => void; onAdd: (id: string, track: Track) => void; onArtist: (track: { artist: string; artist_id?: string }) => void; onAlbum?: (albumId: string) => void; onPlaylist?: (playlistId: string) => void; onQueue: (track: Track) => void; current: Track | null; queue: Track[]; mix: Track | null; onMix: (track: Track | null) => void; history: Track[]; popular: Track[]; forYou: Track[]; searchResults: Track[]; albumResults?: CatalogAlbum[]; artistResults?: CatalogArtist[]; searchQuery: string; searchCategory: SearchCategory; onSearchCategory: (category: SearchCategory) => void; searchLoading?: boolean; searchError?: string; onPlay: (track: Track, queue: Track[]) => void }) {
  const openSongMenu = useSongMenu();
  const seeds = Array.from(new Map([...history, ...forYou, ...popular].filter((track) => track.id && hasArtworkURL(track.album_art_url)).map((track) => [track.id, track])).values());
  const artists = new Set<string>();
  const uniqueArtistSeeds = seeds.filter((track) => {
    const artist = track.artist.toLowerCase().trim();
    if (artists.has(artist)) return false;
    artists.add(artist);
    return true;
  });
  const mixes = (
    uniqueArtistSeeds.length >= 8
      ? uniqueArtistSeeds
      : [...uniqueArtistSeeds, ...seeds.filter((track) => !uniqueArtistSeeds.some((item) => item.id === track.id))]
  ).slice(0, 8);
  const [failedMixIds, setFailedMixIds] = useState<Set<string>>(() => new Set());

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
    mixes.forEach((track) => {
      if (!mixCache.has(track.id)) {
        Music.related(track.id).then((tracks) => {
          if (!mixCache.has(track.id)) {
            mixCache.set(track.id, [track, ...tracks.filter((t) => t.id !== track.id)]);
          }
        }).catch(() => {});
      }
    });
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
    Music.related(mix.id).then((tracks) => {
      const full = [mix, ...tracks.filter((track) => track.id !== mix.id)];
      mixCache.set(mix.id, full);
      if (active) setMixTracks(full);
    }).catch(() => {
      if (active) setMixError("This mix could not be loaded.");
    }).finally(() => {
      if (active) setMixLoading(false);
    });
    return () => { active = false; };
  }, [mix, mixRetry]);
  if (searchQuery) return <SearchResults key={searchQuery} query={searchQuery} category={searchCategory} onCategory={onSearchCategory} loading={searchLoading} error={searchError} tracks={searchResults} albums={albumResults} artists={artistResults} playlists={playlists} liked={liked} current={current} onPlay={onPlay} onLike={onLike} onQueue={onQueue} onArtist={onArtist} onAlbum={onAlbum || (() => {})} onPlaylist={onPlaylist || (() => {})} />;
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
            <div className="detail-empty" role="alert">
              <p>{mixError}</p>
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
                          <small className="song-sub-label">{track.album || "Daily Mix"}</small>
                        </span>
                      </span>

                      <span
                        className="song-author-cell"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <MarqueeText className="song-author-marquee">
                          <ArtistLinks track={track} onOpen={onArtist} />
                        </MarqueeText>
                      </span>

                      <span className="song-duration-cell" onClick={(e) => e.stopPropagation()}>
                        <span className="duration-digits">{track.duration}</span>
                        <button
                          className="detail-icon"
                          type="button"
                          aria-label={`${liked.some((item) => item.id === track.id) ? "Unlike" : "Like"} ${track.title}`}
                          aria-pressed={liked.some((item) => item.id === track.id)}
                          onClick={() => onLike(track)}
                        >
                          <Heart
                            size={17}
                            fill={liked.some((item) => item.id === track.id) ? "currentColor" : "none"}
                          />
                        </button>
                        <button
                          className="detail-icon"
                          type="button"
                          aria-label={`Add ${track.title} to queue`}
                          onClick={() => onQueue(track)}
                        >
                          <ListPlus size={20} />
                        </button>
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
  return <>
    <FeedSection
      title="Discover"
      description="A mix shaped around your listening"
      count={discoverTracks.length}
      onNearEnd={loadMoreDiscover}
      empty={
        discoverLoading ? (
          <p className="feed-message" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Classic /> Finding music to discover…
          </p>
        ) : (
          <p className="feed-message">Play a few songs to help discover your sound.</p>
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
    <FeedSection title="Recents" description="Your latest listens" count={history.length} empty={<div className="empty"><History size={28} /><strong>Nothing here yet</strong><span>Songs you listen to will show up here.</span></div>}>{(ref) => <Rows liked={liked} playlists={playlists} onLike={onLike} onAdd={onAdd} onArtist={onArtist} onQueue={onQueue} current={current} queue={queue} tracks={history} onPlay={onPlay} rowRef={ref} />}</FeedSection>
    <FeedSection title="Daily Mix" description="Made for you" count={mixes.length} noNav empty={<p className="feed-message">Listen to a few songs to get your daily mix.</p>}>{() => <div className="daily-mix-grid">{mixes.filter((track) => hasArtworkURL(track.album_art_url) && !failedMixIds.has(track.id)).map((track, index) => <button className="mix-card" key={track.id} type="button" onClick={() => onMix(track)}><Artwork src={track.album_art_url} size={280} lazy onFail={() => setFailedMixIds((prev) => new Set(prev).add(track.id))} /><span>Daily Mix {index + 1}</span></button>)}</div>}</FeedSection>
    <FeedSection title="For You" description="More of what you love" count={forYou.length} empty={<p className="feed-message">Listen to or like songs to shape your feed.</p>}>{(ref) => <Rows liked={liked} playlists={playlists} onLike={onLike} onAdd={onAdd} onArtist={onArtist} onQueue={onQueue} current={current} queue={queue} tracks={forYou} onPlay={onPlay} rowRef={ref} />}</FeedSection>
  </>;
}
