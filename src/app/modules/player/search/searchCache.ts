import { Music, type CatalogAlbum, type CatalogArtist, type CatalogPlaylist, type Track } from "../../../mygo";

const TTL_MS = 45 * 60 * 1000;
const MAX_ENTRIES = 64;

type Timed<T> = { value: T; expires: number };

const tracksCache = new Map<string, Timed<Track[]>>();
const albumsCache = new Map<string, Timed<CatalogAlbum[]>>();
const artistsCache = new Map<string, Timed<CatalogArtist[]>>();
const playlistsCache = new Map<string, Timed<CatalogPlaylist[]>>();
const suggestionsCache = new Map<string, Timed<string[]>>();

const tracksInflight = new Map<string, Promise<Track[]>>();
const albumsInflight = new Map<string, Promise<CatalogAlbum[]>>();
const artistsInflight = new Map<string, Promise<CatalogArtist[]>>();
const playlistsInflight = new Map<string, Promise<CatalogPlaylist[]>>();
const suggestionsInflight = new Map<string, Promise<string[]>>();

function cacheKey(query: string) {
  return query.trim().toLocaleLowerCase();
}

function prune<T>(cache: Map<string, Timed<T>>) {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expires <= now) cache.delete(key);
  }
  while (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function readCache<T>(cache: Map<string, Timed<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache<T>(cache: Map<string, Timed<T>>, key: string, value: T) {
  if (Array.isArray(value) && value.length === 0) return;
  prune(cache);
  cache.set(key, { value, expires: Date.now() + TTL_MS });
}

function cachedLoad<T>(
  cache: Map<string, Timed<T>>,
  inflight: Map<string, Promise<T>>,
  query: string,
  loader: (query: string) => Promise<T>,
  fallback: T,
): Promise<T> {
  const key = cacheKey(query);
  if (!key) return Promise.resolve(fallback);
  const hit = readCache(cache, key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = loader(query)
    .then((value) => {
      writeCache(cache, key, value);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

export function cachedSearchTracks(query: string) {
  return cachedLoad(tracksCache, tracksInflight, query, (value) => Music.search(value), []);
}

export function cachedSearchAlbums(query: string) {
  return cachedLoad(albumsCache, albumsInflight, query, (value) => Music.albums(value), []);
}

export function cachedSearchArtists(query: string) {
  return cachedLoad(artistsCache, artistsInflight, query, (value) => Music.artists(value), []);
}

export function cachedSearchPlaylists(query: string) {
  return cachedLoad(playlistsCache, playlistsInflight, query, (value) => Music.playlists(value), []);
}

export function cachedSearchSuggestions(query: string) {
  return cachedLoad(suggestionsCache, suggestionsInflight, query, (value) => Music.suggestions(value), []);
}

export type SearchPageCache = {
  tracks: Track[];
  albums: CatalogAlbum[];
  artists: CatalogArtist[];
  playlists: CatalogPlaylist[];
  error: string;
};

export type SearchSuggestCache = {
  suggestions: string[];
  preview: Track[];
  artists: CatalogArtist[];
  tracksFailed: boolean;
  failed: boolean;
};

export function peekSearchPage(query: string): SearchPageCache | null {
  const key = cacheKey(query);
  if (!key) return null;
  const tracks = readCache(tracksCache, key);
  const albums = readCache(albumsCache, key);
  const artists = readCache(artistsCache, key);
  const playlists = readCache(playlistsCache, key);
  if (!tracks && !albums && !artists && !playlists) return null;
  return {
    tracks: tracks || [],
    albums: albums || [],
    artists: artists || [],
    playlists: playlists || [],
    error: "",
  };
}

export function peekSearchSuggest(query: string): SearchSuggestCache | null {
  const key = cacheKey(query);
  if (!key) return null;
  const suggestions = readCache(suggestionsCache, key);
  const preview = readCache(tracksCache, key);
  const artists = readCache(artistsCache, key);
  if (!suggestions && !preview && !artists) return null;
  return {
    suggestions: (suggestions || []).slice(0, 6),
    preview: preview || [],
    artists: (artists || []).slice(0, 4),
    tracksFailed: false,
    failed: false,
  };
}

export async function loadSearchPage(query: string): Promise<SearchPageCache> {
  const results = await Promise.allSettled([
    cachedSearchTracks(query),
    cachedSearchAlbums(query),
    cachedSearchArtists(query),
    cachedSearchPlaylists(query),
  ]);
  const failures = results.filter((result) => result.status === "rejected").length;
  return {
    tracks: results[0].status === "fulfilled" ? results[0].value : [],
    albums: results[1].status === "fulfilled" ? results[1].value : [],
    artists: results[2].status === "fulfilled" ? results[2].value : [],
    playlists: results[3].status === "fulfilled" ? results[3].value : [],
    error: failures === 0 ? "" : failures === 4 ? "Search is unavailable. Try again." : "Some results could not be loaded. Try again.",
  };
}

export async function loadSearchSuggest(query: string): Promise<SearchSuggestCache> {
  const results = await Promise.allSettled([
    cachedSearchSuggestions(query),
    cachedSearchTracks(query),
    cachedSearchArtists(query),
  ]);
  const failures = results.filter((result) => result.status === "rejected").length;
  return {
    suggestions: results[0].status === "fulfilled" ? (results[0].value || []).slice(0, 6) : [],
    preview: results[1].status === "fulfilled" ? results[1].value || [] : [],
    artists: results[2].status === "fulfilled" ? (results[2].value || []).slice(0, 4) : [],
    tracksFailed: results[1].status === "rejected",
    failed: failures > 0,
  };
}
