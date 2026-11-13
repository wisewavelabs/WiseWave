import { useState } from "react";
import { Play } from "lucide-react";
import type { Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { ArtistLinks } from "../shared/ArtistLinks";
import { useSongMenu } from "../shared/SongMenu";
import { countLabel, formatListened, formatWhen, trackFromListening } from "./format";
import type { ListeningTopAlbum, ListeningTopArtist, ListeningTopTrack } from "./types";

const VISIBLE = 5;

export function TopLists({
  tracks,
  artists,
  albums,
  timezone,
  onPlay,
  onArtist,
  onAlbum,
  current,
  playing,
}: {
  tracks: ListeningTopTrack[];
  artists: ListeningTopArtist[];
  albums: ListeningTopAlbum[];
  timezone: string;
  onPlay: (track: Track, tracks: Track[]) => void;
  onArtist: (artist: { artist: string; artist_id?: string }) => void;
  onAlbum: (albumId: string) => void;
  current?: Track | null;
  playing?: boolean;
}) {
  const queue = tracks.map(trackFromListening);
  return (
    <section className="listening-section" aria-labelledby="listening-tops">
      <h2 id="listening-tops">Top music</h2>
      <p className="listening-note">Ranked by time you actually listened.</p>
      <div className="listening-tops">
        <ol className="listening-ranks">
          <li className="listening-rank-heading">Tracks</li>
          {tracks.length ? <TrackRanks items={tracks} queue={queue} timezone={timezone} onPlay={onPlay} onArtist={onArtist} current={current} playing={playing} /> : <li className="listening-note">No tracks in this period.</li>}
        </ol>
        <ol className="listening-ranks">
          <li className="listening-rank-heading">Artists</li>
          {artists.length ? <ArtistRanks items={artists} onArtist={onArtist} /> : <li className="listening-note">No artists in this period.</li>}
        </ol>
        <ol className="listening-ranks">
          <li className="listening-rank-heading">Albums</li>
          {albums.length ? <AlbumRanks items={albums} onArtist={onArtist} onAlbum={onAlbum} /> : <li className="listening-note">No albums in this period.</li>}
        </ol>
      </div>
    </section>
  );
}

function TrackRanks({
  items,
  queue,
  timezone,
  onPlay,
  onArtist,
  current,
  playing,
}: {
  items: ListeningTopTrack[];
  queue: Track[];
  timezone: string;
  onPlay: (track: Track, tracks: Track[]) => void;
  onArtist: (artist: { artist: string; artist_id?: string }) => void;
  current?: Track | null;
  playing?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const openSongMenu = useSongMenu();
  const visible = expanded ? items : items.slice(0, VISIBLE);
  return (
    <>
      {visible.map((item, index) => {
        const track = trackFromListening(item);
        const last = formatWhen(item.last_played_ms, timezone, { month: "short", day: "numeric" });
        return (
          <li key={`${item.track_id}-${index}`} className="listening-row" data-current={playing && current?.id === item.track_id ? "true" : undefined} onContextMenu={(event) => { if (track.id) openSongMenu(event, track); }}>
            <span className="listening-rank-index">{index + 1}</span>
            <button className="listening-play" type="button" aria-label={`Play ${item.title}`} disabled={!track.id} onClick={() => onPlay(track, queue)}><Artwork src={item.artwork_url} size={72} /><Play size={14} /></button>
            <div className="listening-row-copy">
              <MarqueeText className="listening-row-title">{item.title}</MarqueeText>
              {item.artist ? <MarqueeText className="listening-row-sub"><ArtistLinks track={track} onOpen={(next) => onArtist({ artist: next.artist, artist_id: next.artist_id })} /></MarqueeText> : null}
            </div>
            <div className="listening-row-meta">
              <strong>{formatListened(item.listened_ms)}</strong>
              <span>{countLabel(item.plays, "play")}</span>
              {last ? <span>{last}</span> : null}
            </div>
          </li>
        );
      })}
      {items.length > VISIBLE ? <li><button className="listening-more" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : `Show ${items.length - VISIBLE} more`}</button></li> : null}
    </>
  );
}

function ArtistRanks({ items, onArtist }: { items: ListeningTopArtist[]; onArtist: (artist: { artist: string; artist_id?: string }) => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, VISIBLE);
  return (
    <>
      {visible.map((item, index) => (
        <li key={`${item.artist_id || item.name}-${index}`} className="listening-row">
          <span className="listening-rank-index">{index + 1}</span>
          <button className="listening-play" type="button" aria-label={`Open ${item.name}`} disabled={!item.name} onClick={() => onArtist({ artist: item.name, artist_id: item.artist_id })}>
            <Artwork src={item.artwork_url} size={72} placeholder="user" />
          </button>
          <div className="listening-row-copy">
            <MarqueeText className="listening-row-title">{item.name}</MarqueeText>
            <span className="listening-row-sub">{countLabel(item.tracks, "song")}</span>
          </div>
          <div className="listening-row-meta"><strong>{formatListened(item.listened_ms)}</strong></div>
        </li>
      ))}
      {items.length > VISIBLE ? <li><button className="listening-more" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : `Show ${items.length - VISIBLE} more`}</button></li> : null}
    </>
  );
}

function AlbumRanks({ items, onArtist, onAlbum }: { items: ListeningTopAlbum[]; onArtist: (artist: { artist: string; artist_id?: string }) => void; onAlbum: (albumId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, VISIBLE);
  return (
    <>
      {visible.map((item, index) => (
        <li key={`${item.album_id || item.title}-${index}`} className="listening-row">
          <span className="listening-rank-index">{index + 1}</span>
          <button className="listening-play" type="button" aria-label={item.album_id ? `Open ${item.title}` : item.title} disabled={!item.album_id} onClick={() => { if (item.album_id) onAlbum(item.album_id); }}>
            <Artwork src={item.artwork_url} size={72} />
          </button>
          <div className="listening-row-copy">
            <MarqueeText className="listening-row-title">{item.title}</MarqueeText>
            {item.artist ? <button className="listening-text" type="button" onClick={() => onArtist({ artist: item.artist, artist_id: item.artist_id })}>{item.artist}</button> : null}
            <span className="listening-row-sub">{countLabel(item.tracks, "song")}</span>
          </div>
          <div className="listening-row-meta"><strong>{formatListened(item.listened_ms)}</strong></div>
        </li>
      ))}
      {items.length > VISIBLE ? <li><button className="listening-more" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : `Show ${items.length - VISIBLE} more`}</button></li> : null}
    </>
  );
}
