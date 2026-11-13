import { Play } from "lucide-react";
import type { Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { ArtistLinks } from "../shared/ArtistLinks";
import { useSongMenu } from "../shared/SongMenu";
import { dayKey, formatHistoryDay, formatListened, formatWhen, trackFromPlay } from "./format";
import type { ListeningPlay } from "./types";

export function HistoryList({
  items,
  timezone,
  query,
  from,
  to,
  today,
  status,
  error,
  hasMore,
  onQuery,
  onFrom,
  onTo,
  onMore,
  onPlay,
  onArtist,
  current,
  playing,
}: {
  items: ListeningPlay[];
  timezone: string;
  query: string;
  from: string;
  to: string;
  today: string;
  status: "loading" | "ready" | "error";
  error: string;
  hasMore: boolean;
  onQuery: (value: string) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onMore: () => void;
  onPlay: (track: Track, tracks: Track[]) => void;
  onArtist: (artist: { artist: string; artist_id?: string }) => void;
  current?: Track | null;
  playing?: boolean;
}) {
  const openSongMenu = useSongMenu();
  const queue = items.map(trackFromPlay);
  const groups: { key: string; label: string; items: ListeningPlay[] }[] = [];
  for (const item of items) {
    const key = item.started_at_ms > 0 ? dayKey(item.started_at_ms, timezone) : "undated";
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, label: item.started_at_ms > 0 ? formatHistoryDay(item.started_at_ms, timezone) : "Undated", items: [item] });
  }

  return (
    <section className="listening-section" aria-labelledby="listening-history">
      <h2 id="listening-history">History</h2>
      <div className="listening-filters">
        <input className="listening-search" aria-label="Search listening history" placeholder="Search songs, artists, albums" value={query} onChange={(event) => onQuery(event.target.value)} />
        <label className="listening-date">From<input type="date" aria-label="From date" max={today} value={from} onChange={(event) => onFrom(event.target.value)} /></label>
        <label className="listening-date">To<input type="date" aria-label="To date" max={today} value={to} onChange={(event) => onTo(event.target.value)} /></label>
      </div>
      {status === "error" ? <p className="listening-note">{error || "History could not be loaded."}</p> : null}
      {status === "loading" && items.length === 0 ? <p className="listening-note">Loading history.</p> : null}
      {status === "ready" && items.length === 0 ? <p className="listening-note">{query || from || to ? "No plays match this filter." : "No plays in this period."}</p> : null}
      <div className="listening-history">
        {groups.map((group) => (
          <section key={group.key} className="listening-day">
            <h3>{group.label}</h3>
            <ol>
              {group.items.map((item, index) => {
                const track = trackFromPlay(item);
                const previous = group.items[index - 1];
                const time = formatWhen(item.started_at_ms, timezone, { hour: "numeric", minute: "2-digit" });
                return (
                  <li key={`${item.id || item.track_id}-${item.started_at_ms}-${index}`} className="listening-row" data-session-break={previous && item.session_id && previous.session_id !== item.session_id ? "true" : undefined} data-current={playing && current?.id === item.track_id ? "true" : undefined} onContextMenu={(event) => { if (track.id) openSongMenu(event, track); }}>
                    <button className="listening-play" type="button" aria-label={`Play ${item.title}`} disabled={!track.id} onClick={() => onPlay(track, queue)}><Artwork src={item.artwork_url} size={64} /><Play size={14} /></button>
                    <div className="listening-row-copy">
                      <MarqueeText className="listening-row-title">{item.title}</MarqueeText>
                      {item.artist ? <MarqueeText className="listening-row-sub"><ArtistLinks track={track} onOpen={(next) => onArtist({ artist: next.artist, artist_id: next.artist_id })} /></MarqueeText> : null}
                    </div>
                    <div className="listening-row-meta">
                      {time ? <span>{time}</span> : null}
                      <strong>{formatListened(item.listened_ms)}</strong>
                      <span>{item.completed ? "Completed" : item.qualified ? "Partial" : "Brief"}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
      {hasMore ? <button className="listening-more" type="button" onClick={onMore} disabled={status === "loading"}>{status === "loading" ? "Loading" : "Load more"}</button> : null}
    </section>
  );
}
