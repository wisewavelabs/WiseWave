export const links = {
  site: "https://wisewave.me",
  github: "https://github.com/Fristonn",
  discord: "https://discord.com/users/1240601660984791040",
  community: "https://discord.gg/xNYnxjE6hS",
  krishna: "https://github.com/752k5",
  nihal: "https://github.com/irumadied",
  tone: "https://github.com/70nee",
  lrc: "https://lrc.red",
  lrclib: "https://lrclib.net",
  unison: "https://unison.betterlyrics.org",
  better: "https://betterlyrics.org",
  lyricsPlus: "https://github.com/ibratabian17/lyricsplus",
  pax: "https://lyrics.paxsenix.org",
  simp: "https://www.simpmusic.org",
  amll: "https://github.com/amll-dev/amll-ttml-db",
  kugou: "https://www.kugou.com",
};

export function linkLabel(url: string) {
  return url.replace(/^https:\/\//, "").replace(/\/$/, "");
}
