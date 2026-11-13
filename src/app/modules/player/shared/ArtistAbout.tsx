import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ArtistDetail, Track } from "../../../mygo";
import { loadArtist } from "../catalog/Artist";
import { artistNames } from "./ArtistLinks";
import { PlayerAlert } from "./PlayerAlert";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function ArtistAbout({ track, onArtist }: { track: Track; onArtist: (track: Track) => void }) {
  const names = artistNames(track.artist);
  const [selection, setSelection] = useState({ trackID: track.id, index: 0 });
  const index = selection.trackID === track.id && selection.index < names.length ? selection.index : 0;
  const name = names[index] || track.artist;
  const artistID = index === 0 ? track.artist_id || "" : "";
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [direction, setDirection] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const prefetched = useRef(new Map<string, ArtistDetail>());
  const descriptionId = useId();

  useEffect(() => {
    let active = true;
    prefetched.current.clear();
    artistNames(track.artist).forEach((artistName, artistIndex) => {
      const id = artistIndex === 0 ? track.artist_id || "" : "";
      void loadArtist(id, artistName).then((result) => {
        if (active) prefetched.current.set(`${id}\n${artistName}`, result);
      }).catch(() => {});
    });
    return () => { active = false; };
  }, [track.id, track.artist, track.artist_id]);

  useEffect(() => {
    let active = true;
    const cached = prefetched.current.get(`${artistID}\n${name}`);
    setArtist(cached || null);
    setLoading(!cached);
    setFailed(false);
    setExpanded(false);
    setOverflowing(false);
    setImageFailed(false);
    void loadArtist(artistID, name).then((result) => {
      if (active) {
        prefetched.current.set(`${artistID}\n${name}`, result);
        setArtist(result);
      }
    }).catch(() => {
      if (active) setFailed(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [artistID, name, retry]);

  useLayoutEffect(() => {
    const element = descriptionRef.current;
    if (!element) {
      setOverflowing(false);
      return;
    }
    if (expanded) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const frame = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [artist?.description, expanded, loading]);

  const move = (step: number) => {
    setDirection(step);
    setSelection({ trackID: track.id, index: (index + step + names.length) % names.length });
  };

  return <section className="now-artist-about" aria-label={`About ${name}`} aria-busy={loading}>
    <div className="now-artist-header">
      <h2>Meet the artist</h2>
      {names.length > 1 && <div className="now-artist-navigation"><button type="button" aria-label="Previous artist" onClick={() => move(-1)}><ChevronLeft size={20} /></button><button type="button" aria-label="Next artist" onClick={() => move(1)}><ChevronRight size={20} /></button></div>}
    </div>
    <div key={`${track.id}-${index}`} className="now-artist-slide" data-direction={direction < 0 ? "back" : "forward"}>
    {loading ? <><div className="now-artist-skeleton-banner" /><div className="now-artist-skeleton-info" aria-hidden="true"><span /><span /><span /><span /></div></> : <>
    <div className="now-artist-banner">
      {artist && !imageFailed && (artist.banner_url || artist.artwork_url) && <img src={artist.banner_url || artist.artwork_url} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />}
    </div>
    <div className="now-artist-info">
      <button
        className="now-artist-name"
        type="button"
        onClick={() => onArtist({ ...track, artist: artist?.name || name, artist_id: artist?.id || artistID })}
      >
        {artist?.name || name}
      </button>
      {artist?.monthly_listeners && <div className="now-artist-listeners">{artist.monthly_listeners}</div>}
      <div className="now-artist-about-body">
        {failed ? <PlayerAlert message="Artist details couldn’t load." onDismiss={() => {}} action={{ label: "Retry", onClick: () => setRetry((value) => value + 1) }} /> : artist?.description ?
          <div id={descriptionId} ref={descriptionRef} className="now-artist-description" data-expanded={expanded}>{artist.description}</div> :
          <p>No artist description available.</p>}
      </div>
      <div className="now-artist-about-actions">
        {failed && <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button>}
        {overflowing && <button type="button" aria-expanded={expanded} aria-controls={descriptionId} onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Read more"}</button>}
      </div>
    </div>
    </>}
    </div>
  </section>;
}
