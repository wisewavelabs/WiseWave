import { useEffect, useState } from "react";
import { ArrowLeft, Clock3, Play, Shuffle } from "lucide-react";
import { Music, type PlaylistDetail, type Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { Classic } from "../../../shared/ui/Classic";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { ArtistLinks } from "../shared/ArtistLinks";
import { trackDurationLabel } from "../shared/trackDuration";
import { useSongMenu } from "../shared/SongMenu";

export function Playlist({ id, onBack, onPlay, onArtist }: {
  id: string; onBack: () => void; onPlay: (track: Track, tracks: Track[]) => void; onArtist: (track: Track) => void;
}) {
  const openSongMenu = useSongMenu();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setPlaylist(null); setError("");
    void Music.playlist(id).then((value) => {
      if (!active) return;
      if (value) setPlaylist(value);
      else setError("Playlist is unavailable.");
    }).catch(() => { if (active) setError("Playlist is unavailable."); });
    return () => { active = false; };
  }, [id, retry]);
  const tracks = playlist?.tracks || [];
  const shuffle = () => {
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    if (shuffled.length) onPlay(shuffled[0], shuffled);
  };
  if (!playlist) return <div className="artist-page artist-page-status">
    <button className="mix-back" type="button" onClick={onBack}><ArrowLeft size={18} /> Back</button>
    {error ? <div role="alert"><p className="feed-message">{error}</p><button className="artist-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : <p className="feed-message loading-state" role="status"><Classic />Loading playlist…</p>}
  </div>;
  return <div className="album-page">
    <header className="album-hero">
      <button className="artist-back" type="button" aria-label="Back from playlist" onClick={onBack}><ArrowLeft size={20} /></button>
      <Artwork className="album-cover" src={playlist.artwork_url} size={224} />
      <div className="album-heading"><span className="detail-type">Playlist</span><h1>{playlist.title}</h1>
        <p className="album-byline">{playlist.author && <span>{playlist.author}</span>}<span>{tracks.length} {tracks.length === 1 ? "song" : "songs"}</span></p>
        {playlist.description && <p className="album-description">{playlist.description}</p>}
        <div className="artist-hero-actions"><button type="button" disabled={!tracks.length} onClick={() => onPlay(tracks[0], tracks)}><Play size={18} fill="currentColor" />Play</button><button className="album-shuffle" type="button" disabled={!tracks.length} onClick={shuffle}><Shuffle size={19} />Shuffle</button></div>
      </div>
    </header>
    <section className="artist-catalog" aria-label="Playlist songs">
      <div className="album-columns"><span>#</span><span>Title</span><Clock3 size={16} /></div>
      {tracks.length ? tracks.map((track, index) => <div className="catalog-song" key={track.id} onClick={(event) => { if (event.target instanceof Element && event.target.closest("button, .artist-links")) return; onPlay(track, tracks); }}>
        <span className="catalog-song-number">{index + 1}</span>
        <button className="catalog-song-cover" type="button" aria-label={`Play ${track.title}`} onClick={() => onPlay(track, tracks)}><Artwork src={track.album_art_url || playlist.artwork_url} size={48} lazy /><span><Play size={16} fill="currentColor" /></span></button>
        <div className="catalog-song-info"><button className="song-menu-title" type="button" onContextMenu={(event) => openSongMenu(event, track)} onClick={() => onPlay(track, tracks)}><MarqueeText>{track.title}</MarqueeText></button><MarqueeText><ArtistLinks track={track} onOpen={onArtist} /></MarqueeText></div>
        <span className="catalog-song-duration">{trackDurationLabel(track)}</span>
      </div>) : <p className="feed-message">No songs available for this playlist.</p>}
    </section>
  </div>;
}
