import { useEffect, useState } from "react";
import { ArrowLeft, Clock3, Play, Shuffle } from "lucide-react";
import { Music, type AlbumDetail, type Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { Classic } from "../../../shared/ui/Classic";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { ArtistLinks } from "../shared/ArtistLinks";
import { trackDurationLabel } from "../shared/trackDuration";
import { useSongMenu } from "../shared/SongMenu";

export function Album({ id, onBack, onPlay, onArtist }: {
  id: string; onBack: () => void; onPlay: (track: Track, tracks: Track[]) => void; onArtist: (track: Track) => void;
}) {
  const openSongMenu = useSongMenu();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setAlbum(null); setError("");
    void Music.album(id).then((value) => {
      if (!active) return;
      if (value) setAlbum(value);
      else setError("Album is unavailable.");
    }).catch(() => { if (active) setError("Album is unavailable."); });
    return () => { active = false; };
  }, [id, retry]);
  const tracks = album?.tracks || [];
  const shuffle = () => {
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    if (shuffled.length) onPlay(shuffled[0], shuffled);
  };
  if (!album) return <div className="artist-page artist-page-status">
    <button className="mix-back" type="button" onClick={onBack}><ArrowLeft size={18} /> Back</button>
    {error ? <div role="alert"><p className="feed-message">{error}</p><button className="artist-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : <p className="feed-message loading-state" role="status"><Classic />Loading album…</p>}
  </div>;
  return <div className="album-page">
    <header className="album-hero">
      <button className="artist-back" type="button" aria-label="Back from album" onClick={onBack}><ArrowLeft size={20} /></button>
      <Artwork className="album-cover" src={album.artwork_url} size={224} />
      <div className="album-heading"><span className="detail-type">Album</span><h1>{album.title}</h1>
        <p className="album-byline">{tracks[0] ? <ArtistLinks track={{ ...tracks[0], artist: album.artist || tracks[0].artist }} onOpen={onArtist} /> : album.artist}{album.year && <span>{album.year}</span>}<span>{tracks.length} {tracks.length === 1 ? "song" : "songs"}</span></p>
        {album.description && <p className="album-description">{album.description}</p>}
        <div className="artist-hero-actions"><button type="button" disabled={!tracks.length} onClick={() => onPlay(tracks[0], tracks)}><Play size={18} fill="currentColor" />Play</button><button className="album-shuffle" type="button" disabled={!tracks.length} onClick={shuffle}><Shuffle size={19} />Shuffle</button></div>
      </div>
    </header>
    <section className="artist-catalog" aria-label="Album songs">
      <div className="album-columns"><span>#</span><span>Title</span><Clock3 size={16} /></div>
      {tracks.length ? tracks.map((track, index) => <div className="catalog-song" key={track.id} onClick={(event) => { if (event.target instanceof Element && event.target.closest("button, .artist-links")) return; onPlay(track, tracks); }}>
        <span className="catalog-song-number">{index + 1}</span>
        <button className="catalog-song-cover" type="button" aria-label={`Play ${track.title}`} onClick={() => onPlay(track, tracks)}><Artwork src={album.artwork_url || track.album_art_url} size={48} lazy /><span><Play size={16} fill="currentColor" /></span></button>
        <div className="catalog-song-info"><button className="song-menu-title" type="button" onContextMenu={(event) => openSongMenu(event, { ...track, album_id: track.album_id || id })} onClick={() => onPlay(track, tracks)}><MarqueeText>{track.title}</MarqueeText></button><MarqueeText><ArtistLinks track={track} onOpen={onArtist} /></MarqueeText></div>
        <span className="catalog-song-duration">{trackDurationLabel(track)}</span>
      </div>) : <p className="feed-message">No songs available for this album.</p>}
    </section>
  </div>;
}
