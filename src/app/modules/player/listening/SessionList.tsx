import { useEffect, useState } from "react";
import { ChevronDown, Play } from "lucide-react";
import type { Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { ArtistLinks } from "../shared/ArtistLinks";
import { countLabel, formatListened, formatWhen, trackFromPlay } from "./format";
import { listening } from "./listeningClient";
import type { ListeningPlay, ListeningSession } from "./types";

export function SessionList({
  sessions,
  timezone,
  onPlay,
  onArtist,
  current,
  playing,
}: {
  sessions: ListeningSession[];
  timezone: string;
  onPlay: (track: Track, tracks: Track[]) => void;
  onArtist: (artist: { artist: string; artist_id?: string }) => void;
  current?: Track | null;
  playing?: boolean;
}) {
  const [openId, setOpenId] = useState("");
  const [detail, setDetail] = useState<ListeningSession | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!openId) return;
    const known = sessions.find((session) => session.id === openId);
    if (known?.tracks.length) {
      setDetail(known);
      setStatus("ready");
      return;
    }
    let alive = true;
    setStatus("loading");
    setDetail(known || null);
    listening.session(openId).then((session) => {
      if (!alive) return;
      setDetail(session);
      setStatus(session ? "ready" : "error");
    }).catch(() => {
      if (!alive) return;
      setStatus("error");
    });
    return () => { alive = false; };
  }, [openId, sessions]);

  return (
    <section className="listening-section" aria-labelledby="listening-sessions">
      <h2 id="listening-sessions">Sessions</h2>
      <p className="listening-note">Plays within 30 minutes stay in the same session.</p>
      {sessions.length === 0 ? <p className="listening-note">No sessions in this period.</p> : (
        <ol className="listening-sessions">
          {sessions.map((session) => {
            const open = openId === session.id;
            const shown = open && detail?.id === session.id ? detail : session;
            const start = formatWhen(session.started_at_ms, timezone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            const end = formatWhen(session.ended_at_ms, timezone, { hour: "numeric", minute: "2-digit" });
            return (
              <li key={session.id || `${session.started_at_ms}`} className="listening-session">
                <button className="listening-session-toggle" type="button" aria-expanded={open} onClick={() => setOpenId(open ? "" : session.id)}>
                  <span>
                    <strong>{start}{end ? ` – ${end}` : ""}</strong>
                    <small>{formatListened(session.listened_ms)} · {countLabel(session.plays, "play")}{session.top_artist ? ` · ${session.top_artist}` : ""}</small>
                  </span>
                  <ChevronDown size={16} />
                </button>
                {open ? <SessionTracks session={shown} status={status} timezone={timezone} onPlay={onPlay} onArtist={onArtist} current={current} playing={playing} /> : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function SessionTracks({
  session,
  status,
  timezone,
  onPlay,
  onArtist,
  current,
  playing,
}: {
  session: ListeningSession;
  status: "idle" | "loading" | "ready" | "error";
  timezone: string;
  onPlay: (track: Track, tracks: Track[]) => void;
  onArtist: (artist: { artist: string; artist_id?: string }) => void;
  current?: Track | null;
  playing?: boolean;
}) {
  const tracks = session.tracks;
  const queue = tracks.map(trackFromPlay);
  if (status === "loading" && tracks.length === 0) return <p className="listening-note">Loading this session.</p>;
  if (status === "error" && tracks.length === 0) return <p className="listening-note">This session could not be loaded.</p>;
  if (tracks.length === 0) return <p className="listening-note">No tracks in this session.</p>;
  return (
    <ol className="listening-session-tracks">
      {tracks.map((item, index) => <SessionTrack key={`${item.id}-${item.started_at_ms}-${index}`} item={item} queue={queue} timezone={timezone} onPlay={onPlay} onArtist={onArtist} current={current} playing={playing} />)}
    </ol>
  );
}

function SessionTrack({
  item,
  queue,
  timezone,
  onPlay,
  onArtist,
  current,
  playing,
}: {
  item: ListeningPlay;
  queue: Track[];
  timezone: string;
  onPlay: (track: Track, tracks: Track[]) => void;
  onArtist: (artist: { artist: string; artist_id?: string }) => void;
  current?: Track | null;
  playing?: boolean;
}) {
  const track = trackFromPlay(item);
  const time = formatWhen(item.started_at_ms, timezone, { hour: "numeric", minute: "2-digit" });
  return (
    <li className="listening-row" data-current={playing && current?.id === item.track_id ? "true" : undefined}>
      <button className="listening-play" type="button" aria-label={`Play ${item.title}`} disabled={!track.id} onClick={() => onPlay(track, queue)}><Artwork src={item.artwork_url} size={56} /><Play size={14} /></button>
      <div className="listening-row-copy">
        <MarqueeText className="listening-row-title">{item.title}</MarqueeText>
        {item.artist ? <MarqueeText className="listening-row-sub"><ArtistLinks track={track} onOpen={(next) => onArtist({ artist: next.artist, artist_id: next.artist_id })} /></MarqueeText> : null}
      </div>
      <div className="listening-row-meta">
        {time ? <span>{time}</span> : null}
        <strong>{formatListened(item.listened_ms)}</strong>
      </div>
    </li>
  );
}
