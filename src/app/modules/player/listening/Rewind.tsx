import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { Classic } from "../../../shared/ui/Classic";
import { formatListened, listeningTimezone, periodLabel, shiftMonth, trackFromListening, zonedParts } from "./format";
import { useRewind } from "./useListeningData";
import type { ListeningRewind, ListeningTopArtist } from "./types";

type Focus = "overview" | "time" | "artist" | "song";

function capsuleMinutes(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  return `${minutes.toLocaleString()} minute${minutes === 1 ? "" : "s"}`;
}

function recentMonths(year: number, month: number, count = 5) {
  const items: { year: number; month: number; label: string }[] = [];
  let cursor = { year, month };
  for (let index = 0; index < count; index += 1) {
    cursor = shiftMonth(cursor.year, cursor.month, -1);
    items.push({
      year: cursor.year,
      month: cursor.month,
      label: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(cursor.year, cursor.month - 1, 1))),
    });
  }
  return items;
}

function storyCards(recap: ListeningRewind) {
  const cards: { id: string; title: string; detail: string; art?: string; artB?: string; range: string }[] = [];
  const topArtist = recap.top_artists[0];
  if (topArtist && recap.listened_ms > 0) {
    const share = Math.max(1, Math.min(99, Math.round((topArtist.listened_ms / recap.listened_ms) * 100)));
    cards.push({
      id: "artist-share",
      title: `${share}% of your music listening`,
      detail: `This period, you spent ${formatListened(topArtist.listened_ms)} listening to ${topArtist.name}.`,
      art: topArtist.artwork_url,
      range: recap.label,
    });
  }
  const a = recap.discoveries[0] || recap.top_artists[0];
  const b = recap.discoveries[1] || recap.top_artists[1];
  if (a && b && a.name !== b.name) {
    cards.push({
      id: "combo",
      title: "A combo as unique as you",
      detail: `You listened to ${a.name} and ${b.name} in the same period. Tap to explore ${a.name}.`,
      art: a.artwork_url,
      artB: b.artwork_url,
      range: recap.label,
    });
  }
  for (const item of (recap.records || []).slice(0, 3)) {
    cards.push({
      id: `record-${item.kind}-${item.title}`,
      title: item.title || "Insight",
      detail: item.detail || item.title_name || "",
      art: item.artwork_url,
      range: recap.label,
    });
  }
  for (const milestone of (recap.milestones || []).slice(0, 2)) {
    cards.push({
      id: `milestone-${milestone}`,
      title: "Milestone",
      detail: milestone,
      range: recap.label,
    });
  }
  return cards;
}

export function Rewind({
  onBack,
  onPlay,
  onArtist,
}: {
  onBack: () => void;
  onPlay?: (track: Track, tracks: Track[]) => void;
  onArtist?: (artist: { artist: string; artist_id?: string }) => void;
}) {
  const timezone = useMemo(listeningTimezone, []);
  const now = zonedParts(new Date(), timezone);
  const [cursor, setCursor] = useState({ year: now.y, month: now.m });
  const data = useRewind("month", cursor.year, cursor.month);
  const label = data.recap?.label || periodLabel("month", cursor.year, cursor.month, timezone);
  const [focus, setFocus] = useState<Focus>("overview");
  const [storyIndex, setStoryIndex] = useState(0);
  const atPresent = cursor.year > now.y || (cursor.year === now.y && cursor.month >= now.m);
  const pastMonths = useMemo(() => recentMonths(cursor.year, cursor.month), [cursor.year, cursor.month]);
  const stories = useMemo(() => (data.recap ? storyCards(data.recap) : []), [data.recap]);
  const topArtist = data.recap?.top_artists[0] || null;
  const topSong = data.recap?.top_tracks[0] || null;
  const trackQueue = useMemo(() => (data.recap?.top_tracks || []).map(trackFromListening), [data.recap]);

  const openMonth = (year: number, month: number) => {
    setCursor({ year, month });
    setFocus("overview");
    setStoryIndex(0);
  };

  return (
    <div className="capsule player-scroll">
      <header className="capsule-top">
        <button className="capsule-icon-btn" type="button" aria-label="Back" onClick={focus === "overview" ? onBack : () => setFocus("overview")}>
          <ChevronLeft size={22} />
        </button>
        <div className="capsule-month-row">
          <button type="button" className="capsule-month-nav" aria-label="Previous month" onClick={() => { const next = shiftMonth(cursor.year, cursor.month, -1); openMonth(next.year, next.month); }}>
            <ChevronLeft size={16} />
          </button>
          <h1>{label}</h1>
          <button type="button" className="capsule-month-nav" aria-label="Next month" disabled={atPresent} onClick={() => { const next = shiftMonth(cursor.year, cursor.month, 1); openMonth(next.year, next.month); }}>
            <ChevronRight size={16} />
          </button>
        </div>
        <span className="capsule-top-spacer" aria-hidden />
      </header>

      {data.status === "loading" ? <p className="detail-empty loading-state" role="status"><Classic />Loading your listening…</p> : null}
      {data.status === "error" ? (
        <div className="listening-empty">
          <strong>Your listening could not be loaded</strong>
          <span>{data.error}</span>
          <button type="button" className="listening-more" onClick={data.reload}>Retry</button>
        </div>
      ) : null}
      {data.status === "ready" && data.empty ? (
        <div className="listening-empty">
          <strong>Nothing here yet</strong>
          <span>{data.live
            ? `Keep listening with history on. Stats for ${label} show up here.`
            : "Listen to 5 tracks with history on, then your listening stats fill in."}</span>
        </div>
      ) : null}

      {data.status === "ready" && data.recap && !data.empty && focus === "overview" ? (
        <div className="capsule-body">
          <button className="capsule-card capsule-time" type="button" onClick={() => setFocus("time")}>
            <span className="capsule-card-head"><span>Time listened</span><ChevronRight size={16} /></span>
            <strong>{capsuleMinutes(data.recap.listened_ms)}</strong>
          </button>

          <div className="capsule-split">
            <button className="capsule-card capsule-artist" type="button" disabled={!topArtist} onClick={() => topArtist && setFocus("artist")}>
              <span className="capsule-card-head"><span>Top artist</span><ChevronRight size={16} /></span>
              {topArtist ? (
                <>
                  <strong className="capsule-artist-name">{topArtist.name}</strong>
                  <Artwork className="capsule-artist-art" src={topArtist.artwork_url} size={96} placeholder="user" />
                </>
              ) : <span className="listening-note">No artist yet</span>}
            </button>
            <button className="capsule-card capsule-song" type="button" disabled={!topSong} onClick={() => topSong && setFocus("song")}>
              <span className="capsule-card-head"><span>Top song</span><ChevronRight size={16} /></span>
              {topSong ? (
                <>
                  <strong className="capsule-song-name">{topSong.title}</strong>
                  <Artwork className="capsule-song-art" src={topSong.artwork_url} size={96} />
                </>
              ) : <span className="listening-note">No song yet</span>}
            </button>
          </div>

          {stories.length ? (
            <section className="capsule-stories" aria-label="Listening stories">
              <StoryCard
                card={stories[Math.min(storyIndex, stories.length - 1)]}
                onOpenArtist={onArtist}
                artists={data.recap.top_artists}
                discoveries={data.recap.discoveries}
              />
              {stories.length > 1 ? (
                <div className="capsule-story-nav" role="group" aria-label="Story navigation">
                  <button type="button" aria-label="Previous story" disabled={storyIndex <= 0} onClick={() => setStoryIndex((value) => Math.max(0, value - 1))}><ChevronLeft size={16} /></button>
                  <span>{storyIndex + 1} / {stories.length}</span>
                  <button type="button" aria-label="Next story" disabled={storyIndex >= stories.length - 1} onClick={() => setStoryIndex((value) => Math.min(stories.length - 1, value + 1))}><ChevronRight size={16} /></button>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="capsule-history">
            {pastMonths.map((item) => (
              <button key={`${item.year}-${item.month}`} className="capsule-history-row" type="button" onClick={() => openMonth(item.year, item.month)}>
                <div>
                  <strong>{item.label}</strong>
                  <span>Time listened</span>
                </div>
                <ChevronRight size={16} />
              </button>
            ))}
          </section>
        </div>
      ) : null}

      {data.status === "ready" && data.recap && !data.empty && focus === "time" ? (
        <DetailShell title="Time listened" subtitle={capsuleMinutes(data.recap.listened_ms)} onBack={() => setFocus("overview")}>
          <p className="capsule-detail-copy">{data.recap.plays.toLocaleString()} plays · {data.recap.tracks.toLocaleString()} songs · {data.recap.artists.toLocaleString()} artists</p>
        </DetailShell>
      ) : null}

      {data.status === "ready" && data.recap && !data.empty && focus === "artist" ? (
        <DetailShell title="Top artists" subtitle={label} onBack={() => setFocus("overview")}>
          <ol className="capsule-rank">
            {data.recap.top_artists.map((item, index) => (
              <li key={`${item.artist_id || item.name}-${index}`}>
                <button type="button" className="capsule-rank-row" onClick={() => onArtist?.({ artist: item.name, artist_id: item.artist_id })}>
                  <span>{index + 1}</span>
                  <Artwork src={item.artwork_url} size={56} placeholder="user" />
                  <div>
                    <strong>{item.name}</strong>
                    <small>{formatListened(item.listened_ms)}</small>
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </DetailShell>
      ) : null}

      {data.status === "ready" && data.recap && !data.empty && focus === "song" ? (
        <DetailShell title="Top songs" subtitle={label} onBack={() => setFocus("overview")}>
          <ol className="capsule-rank">
            {data.recap.top_tracks.map((item, index) => {
              const track = trackFromListening(item);
              return (
                <li key={`${item.track_id}-${index}`}>
                  <button type="button" className="capsule-rank-row" onClick={() => onPlay?.(track, trackQueue)}>
                    <span>{index + 1}</span>
                    <Artwork src={item.artwork_url} size={56} />
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.artist} · {formatListened(item.listened_ms)}</small>
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        </DetailShell>
      ) : null}
    </div>
  );
}

export const RewindPage = Rewind;

function DetailShell({ title, subtitle, onBack, children }: { title: string; subtitle: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="capsule-detail">
      <button className="capsule-icon-btn" type="button" aria-label="Back" onClick={onBack}><ChevronLeft size={22} /></button>
      <h2>{title}</h2>
      <p className="capsule-detail-hero">{subtitle}</p>
      {children}
    </div>
  );
}

function StoryCard({
  card,
  onOpenArtist,
  artists,
  discoveries,
}: {
  card: { id: string; title: string; detail: string; art?: string; artB?: string; range: string };
  onOpenArtist?: (artist: { artist: string; artist_id?: string }) => void;
  artists: ListeningTopArtist[];
  discoveries: ListeningTopArtist[];
}) {
  const primary = discoveries[0] || artists[0];
  return (
    <article className="capsule-story">
      <div className="capsule-story-art">
        {card.artB ? (
          <>
            <Artwork className="capsule-story-circle is-left" src={card.art || ""} size={120} placeholder="user" />
            <Artwork className="capsule-story-circle is-right" src={card.artB} size={120} placeholder="user" />
          </>
        ) : (
          <Artwork className="capsule-story-circle" src={card.art || ""} size={140} placeholder="user" />
        )}
      </div>
      <h3>{card.title}</h3>
      <p>{card.detail}</p>
      <div className="capsule-story-foot">
        <span>{card.range}</span>
      </div>
      {card.id === "combo" && primary ? (
        <button className="capsule-story-cta" type="button" onClick={() => onOpenArtist?.({ artist: primary.name, artist_id: primary.artist_id })}>
          Explore {primary.name}
        </button>
      ) : null}
    </article>
  );
}
