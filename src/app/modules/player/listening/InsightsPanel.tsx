import { CalendarClock, Compass, Flag, Heart, Moon, Play, Repeat, Sunrise } from "lucide-react";
import type { Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { countLabel, formatListened, trackFromListening } from "./format";
import type { ListeningInsight, ListeningInsights, ListeningTopTrack } from "./types";

function cardsFromInsights(value: ListeningInsights): ListeningInsight[] {
  const cards: ListeningInsight[] = [];
  for (const track of value.on_repeat.slice(0, 3)) {
    cards.push({
      kind: "on_repeat",
      title: "On repeat",
      detail: track.title,
      track_id: track.track_id,
      title_name: track.title,
      artist: track.artist,
      artist_id: track.artist_id,
      artwork_url: track.artwork_url,
      listened_ms: track.listened_ms,
      plays: track.plays,
    });
  }
  if (value.night_owl) cards.push({ kind: "night_owl", title: "Night owl", detail: "A lot of your listening happens late.", track_id: "", title_name: "", artist: "", artist_id: "", artwork_url: "", listened_ms: 0, plays: 0 });
  if (value.early_bird) cards.push({ kind: "early_bird", title: "Early bird", detail: "Mornings show up in your habits.", track_id: "", title_name: "", artist: "", artist_id: "", artwork_url: "", listened_ms: 0, plays: 0 });
  for (const artist of value.discoveries.slice(0, 5)) {
    cards.push({
      kind: "discoveries",
      title: "New discovery",
      detail: artist.name,
      track_id: "",
      title_name: "",
      artist: artist.name,
      artist_id: artist.artist_id,
      artwork_url: artist.artwork_url,
      listened_ms: artist.listened_ms,
      plays: artist.plays,
    });
  }
  for (const track of value.old_favorites.slice(0, 3)) {
    cards.push({
      kind: "old_favorites",
      title: "Old favorite",
      detail: track.title,
      track_id: track.track_id,
      title_name: track.title,
      artist: track.artist,
      artist_id: track.artist_id,
      artwork_url: track.artwork_url,
      listened_ms: track.listened_ms,
      plays: track.plays,
    });
  }
  if (value.current_streak > 0) {
    cards.push({
      kind: "streak",
      title: "Listening streak",
      detail: `Current streak: ${value.current_streak} day${value.current_streak === 1 ? "" : "s"}${value.longest_streak ? ` (best ${value.longest_streak})` : ""}.`,
      track_id: "",
      title_name: "",
      artist: "",
      artist_id: "",
      artwork_url: "",
      listened_ms: 0,
      plays: 0,
    });
  }
  for (const milestone of value.milestones) {
    cards.push({ kind: "milestone", title: "Milestone", detail: milestone, track_id: "", title_name: "", artist: "", artist_id: "", artwork_url: "", listened_ms: 0, plays: 0 });
  }
  return cards;
}

function trackFromInsight(item: ListeningInsight): Track {
  return trackFromListening({
    track_id: item.track_id,
    title: item.title_name || item.title,
    artist: item.artist,
    artist_id: item.artist_id,
    album: "",
    album_id: "",
    artwork_url: item.artwork_url,
    track_duration_ms: 0,
  });
}

export function InsightsPanel({
  items,
  onPlay,
}: {
  items: ListeningInsights | ListeningInsight[];
  onPlay: (track: Track, tracks: Track[]) => void;
}) {
  const cards = Array.isArray(items) ? items : cardsFromInsights(items);
  if (!cards.length) return null;
  const playable = cards.filter((item) => item.track_id).map(trackFromInsight);
  return (
    <section className="listening-section" aria-labelledby="listening-insights">
      <h2 id="listening-insights">Insights</h2>
      <ul className="listening-insights">
        {cards.map((item, index) => {
          const Icon = item.kind === "on_repeat" ? Repeat
            : item.kind === "night_owl" ? Moon
              : item.kind === "early_bird" ? Sunrise
                : item.kind === "discoveries" ? Compass
                  : item.kind === "old_favorites" ? Heart
                    : item.kind === "streak" || item.kind === "streaks" ? CalendarClock
                      : Flag;
          const track = item.track_id ? trackFromInsight(item) : null;
          return (
            <li key={`${item.kind}-${item.title}-${index}`} className="listening-insight">
              <Icon size={18} aria-hidden="true" />
              <div>
                {item.title ? <strong>{item.title}</strong> : null}
                {item.detail ? <p>{item.detail}</p> : null}
                {item.listened_ms > 0 || item.plays > 0 ? <small>{[item.listened_ms > 0 ? formatListened(item.listened_ms) : "", item.plays > 0 ? countLabel(item.plays, "play") : ""].filter(Boolean).join(" · ")}</small> : null}
              </div>
              {track ? (
                <button className="listening-play" type="button" aria-label={`Play ${track.title}`} onClick={() => onPlay(track, playable)}>
                  {item.artwork_url ? <Artwork src={item.artwork_url} size={48} /> : <Play size={14} />}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type { ListeningTopTrack };
