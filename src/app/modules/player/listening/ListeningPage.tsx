import { ChevronRight, Headphones } from "lucide-react";
import type { Track } from "../../../mygo";
import { Classic } from "../../../shared/ui/Classic";
import { ActivityCharts } from "./ActivityCharts";
import { HistoryList } from "./HistoryList";
import { InsightsPanel } from "./InsightsPanel";
import { OverviewStats } from "./OverviewStats";
import { RangeChips } from "./RangeChips";
import { SessionList } from "./SessionList";
import { TopLists } from "./TopLists";
import { dayKey } from "./format";
import { useListeningData } from "./useListeningData";

export function ListeningPage({
  onPlay,
  onArtist,
  onAlbum,
  onRewind,
  current,
  playing,
}: {
  onPlay: (track: Track, queue: Track[]) => void;
  onArtist: (artist: { artist: string; artist_id?: string }) => void;
  onAlbum: (albumId: string) => void;
  onRewind: () => void;
  current?: Track | null;
  playing?: boolean;
}) {
  const data = useListeningData();
  const today = dayKey(Date.now(), data.timezone);

  return (
    <div className="listening-page player-scroll">
      <header className="listening-header">
        <div>
          <h1><Headphones size={22} /> Your Listening</h1>
          <p>A journal of what you actually played — not guesses.</p>
        </div>
        <button type="button" className="listening-rewind-link" onClick={onRewind}>
          Sound Capsule <ChevronRight size={16} />
        </button>
      </header>

      <RangeChips value={data.range} onChange={data.setRange} />

      {data.status === "loading" ? <p className="detail-empty loading-state" role="status"><Classic />Loading your listening…</p> : null}
      {data.status === "error" ? (
        <div className="listening-empty">
          <strong>Listening stats could not be loaded</strong>
          <span>{data.error || "Try again in a moment."}</span>
          <button type="button" className="listening-more" onClick={data.reload}>Retry</button>
        </div>
      ) : null}
      {data.empty ? (
        <div className="listening-empty">
          <Headphones size={32} />
          <strong>No listening yet</strong>
          <span>Play some music with history enabled. Insights appear as WiseWave records real listening time.</span>
        </div>
      ) : null}

      {data.status === "ready" && !data.empty && data.overview ? (
        <>
          <OverviewStats overview={data.overview} range={data.range} timezone={data.timezone} />
          <ActivityCharts
            activity={data.activity}
            cells={data.heatmap}
            range={data.range}
            timezone={data.timezone}
            year={data.heatmapYear}
            currentYear={data.currentYear}
            heatmapStatus={data.heatmapStatus}
            onYear={data.setHeatmapYear}
          />
          <TopLists
            tracks={data.tracks}
            artists={data.artists}
            albums={data.albums}
            timezone={data.timezone}
            onPlay={onPlay}
            onArtist={onArtist}
            onAlbum={onAlbum}
            current={current}
            playing={playing}
          />
          <InsightsPanel items={data.insights} onPlay={onPlay} />
          <HistoryList
            items={data.history}
            timezone={data.timezone}
            query={data.historyQuery}
            from={data.historyFrom}
            to={data.historyTo}
            today={today}
            status={data.historyStatus}
            error={data.historyError}
            hasMore={data.historyMore}
            onQuery={data.setHistoryQuery}
            onFrom={data.setHistoryFrom}
            onTo={data.setHistoryTo}
            onMore={data.loadMoreHistory}
            onPlay={onPlay}
            onArtist={onArtist}
            current={current}
            playing={playing}
          />
          <SessionList
            sessions={data.sessions}
            timezone={data.timezone}
            onPlay={onPlay}
            onArtist={onArtist}
            current={current}
            playing={playing}
          />
        </>
      ) : null}
    </div>
  );
}
