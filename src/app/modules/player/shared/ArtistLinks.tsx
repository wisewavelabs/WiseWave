import type { Track } from "../../../mygo";

export function artistNames(artist: string) {
  return artist.split(/\s*(?:,|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring)\s+)\s*/i).map((name) => name.trim()).filter(Boolean);
}

export function ArtistLinks({ track, onOpen }: { track: Track; onOpen: (track: Track) => void }) {
  const names = artistNames(track.artist);
  return <span className="artist-links">{names.map((name, index) => <span key={`${name}-${index}`}>{index > 0 && ", "}<button type="button" onClick={(event) => { event.stopPropagation(); onOpen({ ...track, artist: name, artist_id: index === 0 ? track.artist_id : "" }); }}>{name}</button></span>)}</span>;
}
