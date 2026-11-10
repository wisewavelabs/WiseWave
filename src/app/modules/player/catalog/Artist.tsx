import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Play, Radio, Shuffle } from "lucide-react";
import { Music, type ArtistDetail, type Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { Classic } from "../../../shared/ui/Classic";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { ArtistLinks } from "../shared/ArtistLinks";
import { trackDurationLabel } from "../shared/trackDuration";
import { useSongMenu } from "../shared/SongMenu";

const artistCache = new Map<string, { value: ArtistDetail; expires: number }>();
const artistRequests = new Map<string, Promise<ArtistDetail>>();
const artistKey = (id: string, name: string) => id ? `id:${id}` : `name:${name.trim().toLowerCase()}`;

function cachedArtist(key: string) {
  const entry = artistCache.get(key);
  if (!entry || entry.expires <= Date.now()) { artistCache.delete(key); return null; }
  return entry.value;
}

export function loadArtist(id: string, name: string): Promise<ArtistDetail> {
  const key = artistKey(id, name);
  const cached = cachedArtist(key);
  if (cached) return Promise.resolve(cached);
  const pending = artistRequests.get(key);
  if (pending) return pending;
  const request = (async () => {
    let artistId = id;
    if (!artistId) {
      const matches = await Music.artists(name);
      artistId = matches.find((item) => item.name.toLowerCase() === name.toLowerCase())?.id || "";
    }
    if (!artistId) throw new Error("Artist not found.");
    const result = await Music.artist(artistId);
    if (!result) throw new Error("Artist is unavailable.");
    if (artistCache.size >= 24) artistCache.delete(artistCache.keys().next().value!);
    artistCache.set(key, { value: result, expires: Date.now() + 10 * 60_000 });
    return result;
  })().finally(() => artistRequests.delete(key));
  artistRequests.set(key, request);
  return request;
}

export function Artist({ id, name, onBack, onPlay, onArtist, onAlbum }: {
  id: string; name: string; onBack: () => void;
  onPlay: (track: Track, tracks: Track[]) => void;
  onArtist: (track: Track) => void; onAlbum: (id: string) => void;
}) {
  const openSongMenu = useSongMenu();
  const [artist, setArtist] = useState<ArtistDetail | null>(() => cachedArtist(artistKey(id, name)));
  const [loading, setLoading] = useState(() => !cachedArtist(artistKey(id, name)));
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [descriptionTop, setDescriptionTop] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [showAll, setShowAll] = useState(false);
  const [retry, setRetry] = useState(0);
  const [bannerFailed, setBannerFailed] = useState(false);
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [mixLoading, setMixLoading] = useState(false);
  const [mixError, setMixError] = useState("");
  const mixRequest = useRef(0);

  useEffect(() => {
    let active = true;
    const cached = cachedArtist(artistKey(id, name));
    setLoading(!cached); setError(""); setArtist(cached); setExpanded(false);
    setShowAll(false); setBannerFailed(false); setBannerLoaded(false); setMixLoading(false); setMixError("");
    void loadArtist(id, name).then((result) => { if (active) setArtist(result); }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Artist is unavailable.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; mixRequest.current++; };
  }, [id, name, retry]);

  const tracks = artist?.tracks || [];
  const visible = showAll ? tracks : tracks.slice(0, 20);
  const play = (track: Track, list: Track[]) => {
    mixRequest.current++; setMixLoading(false);
    onPlay(track, list);
  };
  const shuffle = () => {
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    if (shuffled.length) play(shuffled[0], shuffled);
  };
  const startMix = async () => {
    if (!tracks.length || mixLoading) return;
    const request = ++mixRequest.current;
    const seed = tracks[0];
    setMixLoading(true); setMixError("");
    try {
      const related = await Music.related(seed.id);
      if (request === mixRequest.current) onPlay(seed, [seed, ...related.filter((track) => track.id !== seed.id)]);
    } catch { if (request === mixRequest.current) setMixError("This artist mix could not be loaded. Try again."); }
    finally { if (request === mixRequest.current) setMixLoading(false); }
  };
  const banner = artist?.banner_url;
  const backButton = <button className="artist-back" type="button" aria-label="Back from artist" onClick={onBack}><ArrowLeft size={20} /></button>;

  if (loading || error || !artist) return <div className="artist-page artist-page-status">
    {backButton}
    {loading ? <p className="feed-message loading-state" role="status"><Classic />Loading artist…</p> : <div role="alert"><p className="feed-message">{error}</p><button className="artist-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
  </div>;

  return <div className="artist-page">
    <header className="artist-hero" style={expanded ? { paddingTop: descriptionTop, alignItems: "flex-start" } : undefined}>
      {banner && !bannerFailed && !bannerLoaded && <div className="artist-banner-loading" role="status" aria-label="Loading artist banner" />}
      {banner && !bannerFailed && <img className={`artist-banner ${bannerLoaded ? "loaded" : ""}`} onLoad={() => setBannerLoaded(true)} fetchPriority="high" decoding="async" src={banner} alt="" referrerPolicy="no-referrer" onError={() => setBannerFailed(true)} />}
      {backButton}
      <div className="artist-hero-content" ref={contentRef}>
        <h1>{artist.name}</h1>
        {artist.description && <div className="artist-biography"><p className={expanded ? "expanded" : ""}>{artist.description}</p><button type="button" aria-expanded={expanded} onClick={() => { if (!expanded && contentRef.current) setDescriptionTop(contentRef.current.offsetTop); setExpanded(!expanded); }}>{expanded ? "Less" : "More"}</button></div>}
        <div className="artist-hero-actions">
          <button type="button" disabled={!tracks.length} onClick={shuffle}><Shuffle size={21} />Shuffle</button>
          <button type="button" disabled={!tracks.length || mixLoading} aria-busy={mixLoading} onClick={() => { void startMix(); }}>{mixLoading ? <Classic /> : <Radio size={21} />}Mix</button>
        </div>
        {mixError && <p className="artist-mix-error" role="alert">{mixError}</p>}
      </div>
    </header>
    <div className="artist-catalog">
      <section aria-labelledby="catalog-songs">
        <div className="artist-section-heading"><h2 id="catalog-songs">Top songs</h2><span>{tracks.length} songs</span></div>
        {tracks.length ? <div className="artist-top-list">{visible.map((track, index) => <div className="catalog-song" key={track.id} onClick={(event) => { if (event.target instanceof Element && event.target.closest("button, .artist-links")) return; play(track, tracks); }}>
          <span className="catalog-song-number">{index + 1}</span>
          <button className="catalog-song-cover" type="button" aria-label={`Play ${track.title}`} onClick={() => play(track, tracks)}><Artwork src={track.album_art_url} size={48} lazy /><span><Play size={16} fill="currentColor" /></span></button>
          <div className="catalog-song-info"><button className="song-menu-title" type="button" onContextMenu={(event) => openSongMenu(event, track)} onClick={() => play(track, tracks)}><MarqueeText>{track.title}</MarqueeText></button><MarqueeText><ArtistLinks track={track} onOpen={onArtist} /></MarqueeText></div>
          <span className="catalog-song-duration">{trackDurationLabel(track)}</span>
        </div>)}</div> : <p className="feed-message">No songs available for this artist.</p>}
        {tracks.length > 20 && <button className="artist-show-all" type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : `Show all ${tracks.length} songs`}</button>}
      </section>
      <section className="artist-releases" aria-labelledby="artist-releases">
        <div className="artist-section-heading"><h2 id="artist-releases">Releases</h2><span>Albums</span></div>
        {artist.albums?.length ? <div className="artist-album-grid">{artist.albums.map((album) => <button type="button" className="artist-album" key={album.id} onClick={() => onAlbum(album.id)}>
          <span className="artist-album-cover"><Artwork src={album.artwork_url} size={192} lazy /><span><Play size={22} fill="currentColor" /></span></span>
          <MarqueeText>{album.title}</MarqueeText><small>{[album.year, "Album"].filter(Boolean).join(" · ")}</small>
        </button>)}</div> : <p className="feed-message">No albums available for this artist.</p>}
      </section>
    </div>
  </div>;
}
