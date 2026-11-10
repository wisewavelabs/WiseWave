export type LyricsType = "PLAIN" | "LINE_SYNCED" | "SYLLABLE_SYNCED";

export interface LyricSyllable {
  startTimeMs: number;
  endTimeMs?: number;
  text: string;
  isBackground?: boolean;
  appendToPrevious?: boolean;
}

export interface LyricLine {
  startTimeMs: number | null;
  endTimeMs?: number;
  text: string;
  isBackground?: boolean;
  transliteration?: string;
  syllables?: LyricSyllable[];
  accompanimentLines?: LyricLine[];
}

export interface Track {
  trackId: string;
  duration: number;
  artworkUrl?: string | null;
  artworkFallbackUrls?: string[];
}
