import { useState, useMemo, useEffect } from "react";
import { Clock3, Heart, ListMusic, Search } from "lucide-react";
import type { Track } from "../../../mygo";
import { formatAddedAt, type LibraryTrack, type Playlist } from "./useLibrary";
import { ArtistLinks } from "../shared/ArtistLinks";
import { Artwork, artworkURL } from "../../../shared/ui/Artwork";
import { PlayingSpectrum } from "../../../shared/ui/PlayingSpectrum";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { PlayIcon } from "../../../shared/ui/icons";
import { DEFAULT_PLAYLIST_THEME, useImageTheme } from "../shared/artworkColor";
import { trackDurationLabel, trackDurationSeconds } from "../shared/trackDuration";
import { LikedSongsCover } from "./LikedSongsCover";
import { usePlaylistMenu } from "./PlaylistMenu";
import { useSongMenu } from "../shared/SongMenu";

export function Collection({
  kind,
  playlist,
  tracks,
  onPlay,
  onArtist,
  current = null,
  playing = false,
}: {
  kind: "liked" | "playlist";
  playlist?: Playlist;
  tracks: LibraryTrack[];
  onPlay: (track: Track, tracks: Track[], options?: { collection?: boolean }) => void;
  onArtist: (track: Track) => void;
  current?: Track | null;
  playing?: boolean;
}) {
  const openSongMenu = useSongMenu();
  const openPlaylistMenu = usePlaylistMenu();
  const [query, setQuery] = useState("");
  const [coverFailed, setCoverFailed] = useState(false);
  const [fallbackCoverFailed, setFallbackCoverFailed] = useState(false);

  useEffect(() => {
    setCoverFailed(false);
    setFallbackCoverFailed(false);
  }, [playlist?.cover, playlist?.id]);

  const visibleSongs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((song) =>
      `${song.title} ${song.artist} ${song.album || ""}`.toLowerCase().includes(q)
    );
  }, [tracks, query]);

  const totalMinutes = useMemo(() => {
    const totalSeconds = tracks.reduce((sum, song) => sum + trackDurationSeconds(song), 0);
    return Math.max(0, Math.floor(totalSeconds / 60));
  }, [tracks]);
  const statsLabel = `${tracks.length} ${tracks.length === 1 ? "song" : "songs"} of ${totalMinutes} ${totalMinutes === 1 ? "minute" : "minutes"}`;

  const name =
    kind === "liked"
      ? "Liked Songs"
      : playlist?.name || "Playlist";

  const searchPlaceholder =
    kind === "liked"
      ? "Search in Your Library"
      : "Search in playlist";

  const playlistArtwork = useMemo(() => {
    if (kind !== "playlist") return "";
    const firstArt = tracks[0]?.album_art_url || "";
    const source = playlist?.cover && !coverFailed ? playlist.cover : firstArt;
    return artworkURL(source, 256) || source;
  }, [kind, playlist?.cover, tracks, coverFailed]);
  const playlistTheme = useImageTheme(playlistArtwork || null, DEFAULT_PLAYLIST_THEME);

  return (
    <section className={`player-scroll view-enter collection collection-${kind}`}>
      <div className="collection-header" style={kind === "playlist" ? { background: playlistTheme.gradient } : undefined} onContextMenu={(event) => { if (playlist) openPlaylistMenu(event, playlist); }}>
        <div className="collection-heading">
          {kind === "liked" ? (
            <LikedSongsCover className="collection-cover" />
          ) : playlistArtwork && !(coverFailed && fallbackCoverFailed) ? (
            <Artwork
              className="collection-cover playlist-custom-cover"
              src={playlistArtwork}
              size={256}
              onFail={() => {
                if (playlist?.cover && !coverFailed) setCoverFailed(true);
                else setFallbackCoverFailed(true);
              }}
            />
          ) : (
            <div className="collection-cover playlist-cover-fallback">
              <ListMusic size={52} />
            </div>
          )}
          <div className="collection-heading-meta">
            <p className="collection-header-category">Playlist</p>
            <h1 className="collection-header-title"><MarqueeText>{name}</MarqueeText></h1>
            {playlist?.description && (
              <p className="collection-header-desc"><MarqueeText>{playlist.description}</MarqueeText></p>
            )}
            <p className="collection-header-stats">
              <MarqueeText>{statsLabel}</MarqueeText>
            </p>
          </div>
        </div>
      </div>

      <div className="collection-content">
        <div className="collection-toolbar">
          <button
            aria-label={`Play ${name}`}
            className="collection-play-btn"
            disabled={!tracks.length}
            type="button"
            onClick={() => visibleSongs.length && onPlay(visibleSongs[0], visibleSongs, { collection: true })}
          >
            <PlayIcon className="play-icon-glyph" />
          </button>

          <label className="collection-search-label">
            <Search className="search-icon" size={16} />
            <input
              aria-label={searchPlaceholder}
              className="player-search-input"
              placeholder={searchPlaceholder}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="collection-table-header collection-library-table-header">
          <span className="col-num-header">#</span>
          <span className="collection-grid-cols collection-library-grid-cols">
            <span className="col-title-header">Title</span>
            <span className="collection-meta-header">{kind === "liked" ? "Author" : "Album"}</span>
            <span className="col-date-header">Date added</span>
            <Clock3 className="col-duration-icon" size={16} />
          </span>
        </div>

        <div className="collection-songs-list">
          {visibleSongs.map((song, index) => (
            <div
              aria-label={`Play ${song.title} by ${song.artist}`}
              className="collection-song-row group"
              key={song.id}
              role="button"
              tabIndex={0}
              onContextMenu={kind === "liked" ? (event) => openSongMenu(event, song, { kind: "liked" }) : undefined}
              onClick={() => onPlay(song, visibleSongs, { collection: true })}
              onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onPlay(song, visibleSongs, { collection: true }); } }}
            >
              <span className="song-index-num">{index + 1}</span>

              <span className="collection-grid-cols collection-library-grid-cols">
                <span className="song-title-cell">
                  <span className="song-artwork-container">
                    <Artwork
                      className="song-artwork-img"
                      src={song.album_art_url}
                      size={40}
                      lazy
                    />
                    <PlayingSpectrum active={current?.id === song.id} playing={playing} size={24} />
                    <span className="song-play-hover-overlay">
                      <PlayIcon className="play-hover-glyph" />
                    </span>
                  </span>
                  <span className="song-title-wrapper">
                    <span className="song-menu-title" onContextMenu={kind === "playlist" ? (event) => openSongMenu(event, song, playlist ? { kind: "playlist", id: playlist.id } : undefined) : undefined}><MarqueeText className="song-main-title">{song.title}</MarqueeText></span>
                    <small className="song-sub-label">
                      {kind === "liked" ? <>Liked song<span className="song-compact-artist"> · <ArtistLinks track={song} onOpen={onArtist} /></span></> : <ArtistLinks track={song} onOpen={onArtist} />}
                    </small>
                  </span>
                </span>

                <span className="collection-meta-cell">
                  {kind === "liked" ? (
                    <MarqueeText className="collection-meta-marquee song-author-marquee">
                      <ArtistLinks track={song} onOpen={onArtist} />
                    </MarqueeText>
                  ) : (
                    <MarqueeText className="collection-meta-marquee">
                      {song.album || "—"}
                    </MarqueeText>
                  )}
                </span>

                <span className="song-date-cell">
                  {formatAddedAt(song.addedAt) || "—"}
                </span>

                <span className="song-duration-cell">
                  <span className="duration-digits">{trackDurationLabel(song)}</span>
                </span>
              </span>
            </div>
          ))}
        </div>

        {!visibleSongs.length &&
          (query ? (
            <p className="collection-empty-msg">
              No songs in {name} match your search.
            </p>
          ) : kind === "liked" ? (
            <div className="collection-empty-box">
              <Heart className="empty-icon" size={36} />
              <strong className="empty-title">No liked songs yet</strong>
              <p className="empty-subtitle">Songs you like will show up here.</p>
            </div>
          ) : (
            <div className="collection-empty-box">
              <ListMusic className="empty-icon" size={36} />
              <strong className="empty-title">This playlist is empty</strong>
              <p className="empty-subtitle">Songs you add will show up here.</p>
            </div>
          ))}
      </div>
    </section>
  );
}
