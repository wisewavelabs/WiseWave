import { useMemo } from "react";
import { Check, Heart, ListMusic, ListPlus, Play } from "lucide-react";
import type { CatalogAlbum, CatalogArtist, Track } from "../../../mygo";
import type { Playlist } from "../library/useLibrary";
import { Artwork } from "../../../shared/ui/Artwork";
import { Classic } from "../../../shared/ui/Classic";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { ArtistLinks } from "../shared/ArtistLinks";
import { trackDurationLabel } from "../shared/trackDuration";
import { useSongMenu } from "../shared/SongMenu";

const CATEGORIES = ["All", "Tracks", "Albums", "Playlists", "Artists"] as const;
export type SearchCategory = (typeof CATEGORIES)[number];

interface SearchResultsProps {
  query: string;
  category: SearchCategory;
  onCategory: (category: SearchCategory) => void;
  loading?: boolean;
  error?: string;
  tracks: Track[];
  albums: CatalogAlbum[];
  artists: CatalogArtist[];
  playlists: Playlist[];
  liked: Track[];
  current: Track | null;
  onPlay: (track: Track, tracks: Track[]) => void;
  onLike: (track: Track) => void;
  onQueue: (track: Track) => void;
  onArtist: (artist: { artist: string; artist_id?: string }) => void;
  onAlbum: (albumId: string) => void;
  onPlaylist: (playlistId: string) => void;
}

export function SearchResults({
  query,
  category,
  onCategory,
  loading = false,
  error,
  tracks,
  albums,
  artists,
  playlists,
  liked,
  current,
  onPlay,
  onLike,
  onQueue,
  onArtist,
  onAlbum,
  onPlaylist,
}: SearchResultsProps) {
  const openSongMenu = useSongMenu();

  const matchingPlaylists = useMemo(() => {
    const q = query.toLowerCase();
    return playlists.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q))
    );
  }, [playlists, query]);

  const bestMatch = useMemo(() => {
    if (category !== "All" || !tracks.length) return null;
    const words = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    if (!words.length) return null;
    let candidate: { track: Track; score: number } | null = null;
    for (const track of tracks) {
      const text = `${track.title} ${track.artist}`.toLowerCase();
      const matches = words.filter((w) => text.includes(w)).length;
      const score = matches / words.length;
      if (score >= 0.75 && (!candidate || score > candidate.score)) {
        candidate = { track, score };
      }
    }
    return candidate?.track ?? null;
  }, [category, tracks, query]);

  const matchingTracks = useMemo(
    () => (bestMatch ? tracks.filter((t) => t.id !== bestMatch.id) : tracks),
    [tracks, bestMatch]
  );

  const visibleTracks =
    category === "All"
      ? matchingTracks
      : category === "Tracks"
      ? tracks
      : [];

  const visibleAlbums =
    category === "All"
      ? albums
      : category === "Albums"
      ? albums
      : [];

  const visiblePlaylists =
    category === "All"
      ? matchingPlaylists
      : category === "Playlists"
      ? matchingPlaylists
      : [];

  const visibleArtists =
    category === "All"
      ? artists
      : category === "Artists"
      ? artists
      : [];

  const isEmpty =
    (category === "All" &&
      !bestMatch &&
      !visibleTracks.length &&
      !visibleAlbums.length &&
      !visiblePlaylists.length &&
      !visibleArtists.length) ||
    (category === "Tracks" && !visibleTracks.length) ||
    (category === "Albums" && !visibleAlbums.length) ||
    (category === "Playlists" && !visiblePlaylists.length) ||
    (category === "Artists" && !visibleArtists.length);

  return (
    <div className="search-results-page">
      <div className="search-chips-row">
        {CATEGORIES.map((label) => {
          const isSelected = category === label;
          return (
            <button
              key={label}
              type="button"
              className={`search-chip ${isSelected ? "active" : ""}`}
              onClick={() => onCategory(label)}
            >
              {isSelected && <Check size={14} className="search-chip-check" />}
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {error && !isEmpty && <p className="search-results-notice" role="status">{error}</p>}

      {loading && !tracks.length && !albums.length && !artists.length ? (
        <div className="search-results-loading" role="status">
          <Classic />
          <span>Searching…</span>
        </div>
      ) : error && isEmpty ? (
        <div className="search-results-empty" role="alert">
          <h3>Couldn’t load results</h3>
          <p>{error}</p>
        </div>
      ) : isEmpty ? (
        <div className="search-results-empty">
          <h3>No matches</h3>
          <p>Try a different track, artist, album or playlist.</p>
        </div>
      ) : (
        <div className="search-results-content">
          {bestMatch && category === "All" && (
            <div className="search-section">
              <h3 className="search-section-title">Best match</h3>
              <div className="search-best-match">
                <div
                  className="search-best-match-cover"
                  onClick={() => onPlay(bestMatch, tracks)}
                >
                  <Artwork src={bestMatch.album_art_url} size={80} />
                  <span className="search-best-match-play">
                    <Play size={24} fill="currentColor" />
                  </span>
                </div>
                <div className="search-best-match-info">
                  <span
                    className="search-best-match-title song-menu-title"
                    onContextMenu={(event) => openSongMenu(event, bestMatch)}
                    onClick={() => onPlay(bestMatch, tracks)}
                  >
                    <MarqueeText>{bestMatch.title}</MarqueeText>
                  </span>
                  <span className="search-best-match-artist">
                    <ArtistLinks
                      track={bestMatch}
                      onOpen={(artist) =>
                        onArtist({
                          artist: artist.artist,
                          artist_id: artist.artist_id,
                        })
                      }
                    />
                  </span>
                  <span className="search-best-match-badge">Song</span>
                </div>
                <div className="search-best-match-actions">
                  <button
                    type="button"
                    className="search-row-action"
                    aria-label={`${
                      liked.some((item) => item.id === bestMatch.id)
                        ? "Unlike"
                        : "Like"
                    } ${bestMatch.title}`}
                    onClick={() => onLike(bestMatch)}
                  >
                    <Heart
                      size={18}
                      fill={
                        liked.some((item) => item.id === bestMatch.id)
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </button>
                  <button
                    type="button"
                    className="search-row-action"
                    aria-label={`Add ${bestMatch.title} to queue`}
                    onClick={() => onQueue(bestMatch)}
                  >
                    <ListPlus size={20} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {visibleTracks.length > 0 && (
            <div className="search-section">
              <h3 className="search-section-title">Tracks</h3>
              <div className="search-track-list">
                {visibleTracks.map((track) => (
                  <div
                    className={`search-track-row ${
                      current?.id === track.id ? "playing" : ""
                    }`}
                    key={track.id}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`Play ${track.title} by ${track.artist}`}
                      className="search-track-play-btn"
                      onClick={() => onPlay(track, tracks)}
                      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onPlay(track, tracks); } }}
                    >
                      <div className="search-track-artwork">
                        <Artwork src={track.album_art_url} size={48} lazy />
                        <span className="search-track-play-icon">
                          <Play size={18} fill="currentColor" />
                        </span>
                      </div>
                      <div className="search-track-details">
                        <span className="search-track-title song-menu-title" onContextMenu={(event) => openSongMenu(event, track)}>
                          <MarqueeText>{track.title}</MarqueeText>
                        </span>
                        <span className="search-track-artist">
                          <ArtistLinks
                            track={track}
                            onOpen={(artist) =>
                              onArtist({
                                artist: artist.artist,
                                artist_id: artist.artist_id,
                              })
                            }
                          />
                        </span>
                      </div>
                      <span className="search-track-duration">
                        {trackDurationLabel(track)}
                      </span>
                    </div>
                    <div className="search-track-actions">
                      <button
                        type="button"
                        className="search-row-action"
                        aria-label={`${
                          liked.some((item) => item.id === track.id)
                            ? "Unlike"
                            : "Like"
                        } ${track.title}`}
                        onClick={() => onLike(track)}
                      >
                        <Heart
                          size={16}
                          fill={
                            liked.some((item) => item.id === track.id)
                              ? "currentColor"
                              : "none"
                          }
                        />
                      </button>
                      <button
                        type="button"
                        className="search-row-action"
                        aria-label={`Add ${track.title} to queue`}
                        onClick={() => onQueue(track)}
                      >
                        <ListPlus size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleAlbums.length > 0 && (
            <div className="search-section">
              <h3 className="search-section-title">Albums</h3>
              <div className="search-catalog-list">
                {visibleAlbums.map((album) => (
                  <div
                    className="search-catalog-row"
                    key={`album:${album.id}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open album ${album.title}`}
                    onClick={() => onAlbum(album.id)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onAlbum(album.id); } }}
                  >
                    <div className="search-catalog-artwork album-artwork">
                      <Artwork src={album.artwork_url} size={56} lazy />
                    </div>
                    <div className="search-catalog-details">
                      <span className="search-catalog-title">
                        <MarqueeText>{album.title}</MarqueeText>
                      </span>
                      <span className="search-catalog-subtitle">
                        {[album.artist, album.year].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {visiblePlaylists.length > 0 && (
            <div className="search-section">
              <h3 className="search-section-title">Playlists</h3>
              <div className="search-catalog-list">
                {visiblePlaylists.map((playlist) => (
                  <div
                    className="search-catalog-row"
                    key={`playlist:${playlist.id}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open playlist ${playlist.name}`}
                    onClick={() => onPlaylist(playlist.id)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPlaylist(playlist.id); } }}
                  >
                    <div className="search-catalog-artwork playlist-artwork">
                      {playlist.cover ? (
                        <img className="playlist-custom-cover" src={playlist.cover} alt="" />
                      ) : playlist.tracks[0]?.album_art_url ? (
                        <Artwork
                          src={playlist.tracks[0].album_art_url}
                          size={56}
                          lazy
                        />
                      ) : (
                        <div className="search-catalog-placeholder">
                          <ListMusic size={26} />
                        </div>
                      )}
                    </div>
                    <div className="search-catalog-details">
                      <span className="search-catalog-title">
                        <MarqueeText>{playlist.name}</MarqueeText>
                      </span>
                      <span className="search-catalog-subtitle">
                        Playlist · {playlist.tracks.length}{" "}
                        {playlist.tracks.length === 1 ? "song" : "songs"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleArtists.length > 0 && (
            <div className="search-section">
              <h3 className="search-section-title">Artists</h3>
              <div className="search-catalog-list">
                {visibleArtists.map((artist) => (
                  <div
                    className="search-catalog-row"
                    key={`artist:${artist.id}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open artist ${artist.name}`}
                    onClick={() =>
                      onArtist({ artist: artist.name, artist_id: artist.id })
                    }
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onArtist({ artist: artist.name, artist_id: artist.id }); } }}
                  >
                    <div className="search-catalog-artwork artist-artwork">
                      <Artwork src={artist.artwork_url} size={56} lazy />
                    </div>
                    <div className="search-catalog-details">
                      <span className="search-catalog-title">
                        <MarqueeText>{artist.name}</MarqueeText>
                      </span>
                      <span className="search-catalog-subtitle">Artist</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

