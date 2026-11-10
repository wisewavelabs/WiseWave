import { memo, useMemo } from "react";
import type { LyricLine } from "../../../types/lyricRenderer";
import { createLyricWords } from "./lyricAnimation";

const lyricSegmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

export const LyricText = memo(function LyricText({ line, wordSynced }: { line: LyricLine; wordSynced: boolean }) {
  const words = useMemo(() => createLyricWords(line).map((word) => {
    const wordText = word.units.map(unit => unit.text).join("");
    const shapeTogether = !/^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]*$/u.test(wordText);
    if (shapeTogether) return { ...word, characters: [{ text: wordText, start: word.start, end: word.end }], shapeTogether };
    const characters = word.units.flatMap((unit) => {
      const segments = lyricSegmenter && /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]*$/u.test(unit.text)
        ? Array.from(lyricSegmenter.segment(unit.text), ({ segment }) => segment) : [unit.text];
      return segments.map((text, index) => ({
        text,
        start: unit.start + (unit.end - unit.start) * index / segments.length,
        end: unit.start + (unit.end - unit.start) * (index + 1) / segments.length,
      }));
    });
    return { ...word, characters, shapeTogether };
  }), [line]);

  if (!wordSynced || !words.length) return <>{line.text || "♪"}</>;

  return <>{words.map((word, wordIndex) => (
    <span
      className="player-lyric-word"
      data-character-count={word.shapeTogether ? (lyricSegmenter ? Array.from(lyricSegmenter.segment(word.units.map(unit => unit.text).join(""))).length : word.characters.length) : word.characters.length}
      data-end={word.end}
      data-start={word.start}
      data-shaped-word={word.shapeTogether}
      key={wordIndex}
    >
      {word.characters.map((character, index) => (
        <span className="player-lyric-motion" key={index}>
          <span
            className="player-lyric-syllable"
            data-character-index={index}
            data-end={character.end}
            data-lyric-unit
            data-start={character.start}
          >
            {character.text}
          </span>
        </span>
      ))}
    </span>
  ))}</>;
});

export function AccompanimentLyrics({
  line,
  index,
  nextStart,
  before,
}: {
  line: LyricLine;
  index: number;
  nextStart?: number | null;
  before: boolean;
  focus?: boolean;
}) {
  return <>{line.accompanimentLines?.filter((background) => ((background.startTimeMs ?? 0) < (line.startTimeMs ?? 0)) === before).map((background, backgroundIndex) => {
    const end = background.endTimeMs ?? background.syllables?.[background.syllables.length - 1]?.endTimeMs ?? line.endTimeMs ?? nextStart ?? background.startTimeMs;
    return (
      <div
        className="player-lyric-accompaniment"
        data-before={before}
        data-lyric-visible="false"
        key={`${background.startTimeMs}-${backgroundIndex}`}
      >
        <div className="player-lyric-accompaniment-content">
          <p
            aria-label={background.text}
            className="player-lyric-background-text"
            data-lyric-accompaniment={index}
            data-start={background.startTimeMs}
            data-end={end}
            dir="auto"
          >
            <LyricText line={background} wordSynced />
          </p>
        </div>
      </div>
    );
  })}</>;
}
