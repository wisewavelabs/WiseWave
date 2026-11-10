import type { Record } from "../../../mygo";

export const LYRIC_SOURCES: { [key: string]: { name: string; url: string; notice: string } } = {
  lrcred: { name: "LRC.red", url: "https://lrc.red", notice: "Attribution required" },
  lrclib: { name: "LRCLIB", url: "https://lrclib.net", notice: "API usage guidelines" },
  unison: { name: "Unison", url: "https://unison.betterlyrics.org", notice: "Attribution required" },
  betterlyrics: { name: "Better Lyrics", url: "https://betterlyrics.org", notice: "Lyrics service" },
  youlyplus: { name: "LyricsPlus", url: "https://github.com/ibratabian17/lyricsplus", notice: "Lyrics aggregator" },
  paxsenix: { name: "PaxSenix", url: "https://lyrics.paxsenix.org", notice: "Lyrics aggregator" },
  simpmusic: { name: "SimpMusic", url: "https://www.simpmusic.org", notice: "Lyrics service" },
  amll: { name: "AMLL TTML Database", url: "https://github.com/amll-dev/amll-ttml-db", notice: "CC0 contributions; other source terms vary" },
  kugou: { name: "KuGou", url: "https://www.kugou.com", notice: "Lyrics service" },
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
    ? safeURL(credit.contributor_url, "https://unison.betterlyrics.org") : "";
  return <div className="lyrics-credit">
    Lyrics {credit.source === "youlyplus" || credit.source === "betterlyrics" || credit.source === "paxsenix" ? "via" : "from"} <a href={sourceURL} target="_blank" rel="noopener noreferrer">{source.name}</a>
    {credit.contributor && <> · {credit.source === "amll" ? "synced by" : "submitted by"} {contributorURL ? <a href={contributorURL} target="_blank" rel="noopener noreferrer">{credit.contributor}</a> : credit.contributor}</>}
  </div>;
}
