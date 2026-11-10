import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ArtistDetail, Track } from "../../../mygo";
import { loadArtist } from "../catalog/Artist";
import { artistNames } from "./ArtistLinks";

export function ArtistAbout({ track, onArtist }: { track: Track; onArtist: (track: Track) => void }) {
  const name = artistNames(track.artist)[0] || track.artist;
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const descriptionId = useId();

  useEffect(() => {
    let active = true;
    setArtist(null);
    setLoading(true);
    setFailed(false);
    setExpanded(false);
    setOverflowing(false);
    setImageFailed(false);
    void loadArtist(track.artist_id || "", name).then((result) => {
      if (active) setArtist(result);
    }).catch(() => {
      if (active) setFailed(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [track.artist_id, name, retry]);

  useLayoutEffect(() => {
    const element = descriptionRef.current;
    if (!element || expanded) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [artist?.description, expanded]);

  return <section className="now-artist-about" aria-label={`About ${name}`}>
    <div className="now-artist-banner">
      {artist && !imageFailed && (artist.banner_url || artist.artwork_url) && <img src={artist.banner_url || artist.artwork_url} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />}
      <h2>Meet the artist</h2>
    </div>
    <div className="now-artist-info">
      {artist && <button className="now-artist-name" type="button" onClick={() => onArtist({ ...track, artist: artist.name, artist_id: artist.id })}>{artist.name}</button>}
      {artist?.monthly_listeners && <div className="now-artist-listeners">{artist.monthly_listeners}</div>}
      <div className="now-artist-about-body">
        {loading ? <p role="status">Loading artist details…</p> : failed ? <p role="status">Artist details couldn’t load.</p> : artist?.description ?
          <div id={descriptionId} ref={descriptionRef} className="now-artist-description" data-expanded={expanded}>{artist.description}</div> :
          <p>No artist description available.</p>}
      </div>
      <div className="now-artist-about-actions">
        {failed && <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button>}
        {overflowing && <button type="button" aria-expanded={expanded} aria-controls={descriptionId} onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Read more"}</button>}
      </div>
    </div>
  </section>;
}
