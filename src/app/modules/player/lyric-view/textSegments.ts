const graphemeSegmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

export function splitLyricGraphemes(text: string): string[] {
  return graphemeSegmenter ? Array.from(graphemeSegmenter.segment(text), entry => entry.segment) : text ? [text] : [];
}
