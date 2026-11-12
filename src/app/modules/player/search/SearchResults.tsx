import { useMemo } from "react";
import { Check, Heart, ListMusic, ListPlus, Play } from "lucide-react";
import type { CatalogAlbum, CatalogArtist, CatalogPlaylist, Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { PlayingSpectrum } from "../../../shared/ui/PlayingSpectrum";
import { Classic } from "../../../shared/ui/Classic";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { ArtistLinks } from "../shared/ArtistLinks";
import { trackDurationLabel } from "../shared/trackDuration";
import { useSongMenu } from "../shared/SongMenu";
import { PlayerAlert } from "../shared/PlayerAlert";

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
  playlists: CatalogPlaylist[];
  liked: Track[];
  current: Track | null;
  playing?: boolean;
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
  playing = false,
  onPlay,
  onLike,
  onQueue,
  onArtist,
  onAlbum,
  onPlaylist,
}: SearchResultsProps) {
  const openSongMenu = useSongMenu();

  const bestMatch = useMemo(() => {
    if (category !== "All" || !tracks.length) return null;
    const top = tracks[0];
    const words = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    if (!words.length) return top;
    const text = `${top.title} ${top.artist}`.toLowerCase();
    const score = words.filter((word) => text.includes(word)).length / words.length;
    if (score >= 0.5) return top;
    let candidate: { track: Track; score: number } | null = null;
    for (const track of tracks) {
      const trackText = `${track.title} ${track.artist}`.toLowerCase();
      const matches = words.filter((word) => trackText.includes(word)).length;
      const trackScore = matches / words.length;
      if (trackScore >= 0.75 && (!candidate || trackScore > candidate.score)) {
        candidate = { track, score: trackScore };
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
      ? playlists
      : category === "Playlists"
      ? playlists
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

      <PlayerAlert message={error || ""} onDismiss={() => {}} />

      {loading && !tracks.length && !albums.length && !artists.length ? (
        <div className="search-results-loading" role="status">
          <Classic />
          <span>Searching…</span>
        </div>
      ) : error && isEmpty ? null : isEmpty ? (
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
                  <PlayingSpectrum active={current?.id === bestMatch.id} playing={playing} size={32} placement="corner" />
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
                        <PlayingSpectrum active={current?.id === track.id} playing={playing} size={28} />
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
                    aria-label={`Open playlist ${playlist.title}`}
                    onClick={() => onPlaylist(playlist.id)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPlaylist(playlist.id); } }}
                  >
                    <div className="search-catalog-artwork playlist-artwork">
                      {playlist.artwork_url ? (
                        <Artwork src={playlist.artwork_url} size={56} lazy />
                      ) : (
                        <div className="search-catalog-placeholder">
                          <ListMusic size={26} />
                        </div>
                      )}
                    </div>
                    <div className="search-catalog-details">
                      <span className="search-catalog-title">
                        <MarqueeText>{playlist.title}</MarqueeText>
                      </span>
                      <span className="search-catalog-subtitle">
                        {[playlist.author, "Playlist"].filter(Boolean).join(" · ")}
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
                      <Artwork src={artist.artwork_url} size={56} lazy placeholder="user" allowNonSquare />
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

