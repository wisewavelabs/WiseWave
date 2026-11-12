import type { Record } from "../../../mygo";
import { links } from "../../../shared/links";

export const LYRIC_SOURCES: { [key: string]: { name: string; url: string; notice: string } } = {
  lrcred: { name: "LRC.red", url: links.lrc, notice: "Attribution required" },
  lrclib: { name: "LRCLIB", url: links.lrclib, notice: "API usage guidelines" },
  unison: { name: "Unison", url: links.unison, notice: "Attribution required" },
  betterlyrics: { name: "Better Lyrics", url: links.better, notice: "Lyrics service" },
  youlyplus: { name: "LyricsPlus", url: links.lyricsPlus, notice: "Lyrics aggregator" },
  paxsenix: { name: "PaxSenix", url: links.pax, notice: "Lyrics aggregator" },
  simpmusic: { name: "SimpMusic", url: links.simp, notice: "Lyrics service" },
  amll: { name: "AMLL TTML Database", url: links.amll, notice: "CC0 contributions; other source terms vary" },
  kugou: { name: "KuGou", url: links.kugou, notice: "Lyrics service" },
  youtube_music: { name: "YouTube Music", url: "https://music.youtube.com", notice: "Lyrics service" },
  youtube_subtitle: { name: "YouTube", url: "https://www.youtube.com", notice: "Captions" },
};

function safeURL(url: string | undefined, origin: string): string {
  try { return url && new URL(url).origin === origin ? url : origin; }
  catch { return origin; }
}

export function LyricCredit({ credit }: { credit: Record }) {
  const source = LYRIC_SOURCES[credit.source];
  if (!source) return null;
  const sourceURL = safeURL(credit.source_url, source.url);
  const contributorURL = credit.source === "unison" && credit.contributor_url
    ? safeURL(credit.contributor_url, links.unison) : "";
  return <div className="lyrics-credit">
    Lyrics {credit.source === "youlyplus" || credit.source === "betterlyrics" || credit.source === "paxsenix" || credit.source === "unison" ? "via" : "from"} <a href={sourceURL} target="_blank" rel="noopener noreferrer">{source.name}</a>
    {credit.contributor && <> {credit.source === "unison" ? "–" : "·"} {credit.source === "amll" ? "synced by" : "submitted by"} {contributorURL ? <a href={contributorURL} target="_blank" rel="noopener noreferrer">{credit.contributor}</a> : credit.contributor}</>}
  </div>;
}
