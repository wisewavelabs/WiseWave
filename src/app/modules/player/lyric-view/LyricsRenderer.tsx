"use client";

import { LyricCredit } from "./LyricCredit";
import type { Record as LyricsRecord } from "../../../mygo";

import { AudioLines, Clock3 } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import type { LyricLine, LyricsType, Track } from "../../../types/lyricRenderer";
import {
  animateLyrics,
  createLyricWords,
  findActiveLyricIndex,
  getLyricTop,
  type LyricMetrics,
} from "./lyricAnimation";
import type { PlaybackClock } from "./playbackClock";
import { LyricsFlipbook } from "./LyricsFlipbook";

const NativeLyricsRenderer = lazy(() => import("./NativeLyricsRenderer"));

const LYRIC_AUTO_SCROLL_DURATION_MS = 550;
const LYRIC_RESYNC_SCROLL_DURATION_MS = 650;
const LYRIC_RETURN_SCROLL_DURATION_MS = 700;
const lyricSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
const LYRICS_LOADING_MESSAGE = "Getting the words ready, one sec";

const LyricText = memo(function LyricText({
  line,
  wordSynced,
}: {
  line: LyricLine;
  wordSynced: boolean;
}) {
  const words = useMemo(
    () =>
      createLyricWords(line).map((word) => {
        const wordText = word.units.map((unit) => unit.text).join("");
        const shapeTogether =
          !/^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]*$/u.test(
            wordText
          );
        if (shapeTogether)
          return {
            ...word,
            characters: [{ text: wordText, start: word.start, end: word.end }],
            shapeTogether,
          };
        const characters = word.units.flatMap((unit) => {
          const segments =
            lyricSegmenter &&
            /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]*$/u.test(
              unit.text
            )
              ? Array.from(lyricSegmenter.segment(unit.text), ({ segment }) => segment)
              : [unit.text];
          return segments.map((text, index) => ({
            text,
            start: unit.start + ((unit.end - unit.start) * index) / segments.length,
            end: unit.start + ((unit.end - unit.start) * (index + 1)) / segments.length,
          }));
        });
        return { ...word, characters, shapeTogether };
      }),
    [line]
  );
  if (!wordSynced || !words.length) return <>{line.text || "♪"}</>;
  return (
    <>
      {words.map((word, wordIndex) => (
        <span
          className="player-lyric-word"
          data-character-count={
            word.shapeTogether
              ? lyricSegmenter
                ? Array.from(lyricSegmenter.segment(word.units.map((unit) => unit.text).join("")))
                    .length
                : word.characters.length
              : word.characters.length
          }
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
      ))}
    </>
  );
});

function AccompanimentLyrics({
  line,
  index,
  nextStart,
  before,
}: {
  line: LyricLine;
  index: number;
  nextStart?: number | null;
  before: boolean;
}) {
  return (
    <>
      {line.accompanimentLines
        ?.filter((background) => (background.startTimeMs ?? 0) < (line.startTimeMs ?? 0) === before)
        .map((background, backgroundIndex) => {
          const end =
            background.endTimeMs ??
            background.syllables?.[background.syllables.length - 1]?.endTimeMs ??
            line.endTimeMs ??
            nextStart ??
            background.startTimeMs;
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
        })}
    </>
  );
}

const ExistingLyrics = memo(function ExistingLyrics({
  credit,
  activeIndex: confirmedActiveIndex,
  clock,
  isLoading,
  lines,
  lyricsRef,
  onSelect,
  syncVersion,
  track,
  translationLines,
  type,
  unavailable,
}: {
  credit: LyricsRecord | null;
  activeIndex: number;
  isLoading: boolean;
  lines: LyricLine[];
  lyricsRef: RefObject<HTMLDivElement | null>;
  onSelect: (positionMs: number) => void;
  clock: PlaybackClock;
  track: Track;
  syncVersion: number;
  translationLines: LyricLine[] | null;
  type: LyricsType;
  unavailable: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(confirmedActiveIndex);
  const metricsRef = useRef<LyricMetrics | null>(null);
  const animationRef = useRef<number | null>(null);
  const initialLyricsPositionedRef = useRef(false);
  const previousActiveIndexRef = useRef(activeIndex);
  const previousSyncVersionRef = useRef(syncVersion);
  const pendingSeekIndexRef = useRef<number | null>(null);
  const scrollDurationRef = useRef(LYRIC_AUTO_SCROLL_DURATION_MS);
  const returningToLyricsRef = useRef(false);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const scrollbarSpacerRef = useRef<HTMLSpanElement>(null);
  const [detachedLyrics, setDetachedLyrics] = useState<LyricLine[] | null>(null);
  const [selectedTranslation, setSelectedTranslation] = useState<LyricLine[] | null>(null);
  const reduceMotion = false;
  const showTranslation = Boolean(translationLines && selectedTranslation === translationLines);
  const displayedLines = showTranslation && translationLines ? translationLines : lines;
  const followingActiveLyric = detachedLyrics !== displayedLines;
  const synced = type !== "PLAIN";
  const wordSynced = type === "SYLLABLE_SYNCED" && !showTranslation;

  useLayoutEffect(() => {
    initialLyricsPositionedRef.current = false;
    pendingSeekIndexRef.current = null;
    returningToLyricsRef.current = false;
    if (lyricsRef.current) lyricsRef.current.dataset.lyricSmoothReturn = "false";
  }, [displayedLines, lyricsRef, track.trackId]);

  useLayoutEffect(() => {
    const container = lyricsRef.current;
    if (!container || isLoading || !synced) return;
    return animateLyrics({
      container,
      clock,
      lines: displayedLines,
      reducedMotion: Boolean(reduceMotion),
      wordSynced,
      onActiveIndex: setActiveIndex,
      onMeasure: (metrics) => {
        metricsRef.current = metrics;
      },
    });
  }, [clock, displayedLines, isLoading, lyricsRef, reduceMotion, synced, wordSynced]);

  useLayoutEffect(() => {
    const container = lyricsRef.current;
    const scrollbar = scrollbarRef.current;
    const spacer = scrollbarSpacerRef.current;
    if (!container) return;
    if (isLoading) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      initialLyricsPositionedRef.current = false;
      container.scrollTop = 0;
      if (scrollbar) scrollbar.scrollTop = 0;
      return;
    }
    if (initialLyricsPositionedRef.current || !displayedLines.length) return;
    initialLyricsPositionedRef.current = true;
    const line = container.querySelector<HTMLElement>(`[data-lyric-index="${activeIndex}"]`);
    const target =
      synced && line && activeIndex >= 0
        ? getLyricTop(container, line) - container.clientHeight / 2 + line.clientHeight / 2
        : 0;
    if (scrollbar && spacer) {
      spacer.style.height = `${Math.max(
        scrollbar.clientHeight + 1,
        container.scrollHeight - container.clientHeight + scrollbar.clientHeight
      )}px`;
    }
    container.scrollTop = target;
    if (scrollbar) scrollbar.scrollTop = container.scrollTop;
  }, [activeIndex, displayedLines, isLoading, lyricsRef, synced]);

  const centerActiveLyric = useCallback(
    (force = false) => {
      const container = lyricsRef.current;
      const metrics = metricsRef.current;
      const returning = returningToLyricsRef.current;
      if (returning && !clock.isReady()) return;
      const focusIndex = returning
        ? findActiveLyricIndex(displayedLines, clock.read(performance.now()), undefined, wordSynced)
        : activeIndex;
      const line = container?.querySelector<HTMLElement>(`[data-lyric-index="${focusIndex}"]`);
      if (document.hidden || !container || !metrics || !line || focusIndex < 0) return;
      if (metrics.scrollHeight <= metrics.height + 1 || (!force && !followingActiveLyric)) return;
      const target = Math.max(
        0,
        Math.min(
          metrics.scrollHeight - container.clientHeight,
          getLyricTop(container, line) - container.clientHeight / 2 + line.offsetHeight / 2
        )
      );
      const start = container.scrollTop;
      const distance = target - start;
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      if (Math.abs(distance) < 1) {
        returningToLyricsRef.current = false;
        container.dataset.lyricSmoothReturn = "false";
        scrollDurationRef.current = LYRIC_AUTO_SCROLL_DURATION_MS;
        return;
      }
      const startedAt = performance.now();
      if (wordSynced) {
        returningToLyricsRef.current = false;
        container.dataset.lyricSmoothReturn = "false";
        container.scrollTop = target;
        container.dispatchEvent(new Event("lyricresync"));
        scrollDurationRef.current = LYRIC_AUTO_SCROLL_DURATION_MS;
        return;
      }
      container.dataset.lyricSmoothReturn = "true";
      const durationMs = reduceMotion
        ? 0
        : returning
        ? LYRIC_RETURN_SCROLL_DURATION_MS
        : scrollDurationRef.current;
      const step = (timestamp: number) => {
        const progress = Math.min(1, durationMs ? (timestamp - startedAt) / durationMs : 1);
        if (document.hidden) {
          animationRef.current = null;
          returningToLyricsRef.current = true;
          return;
        }
        const easedProgress =
          durationMs === LYRIC_RESYNC_SCROLL_DURATION_MS
            ? progress * progress * (3 - 2 * progress)
            : 1 - Math.pow(1 - progress, 3);
        container.scrollTop = start + distance * easedProgress;
        if (progress < 1) {
          animationRef.current = requestAnimationFrame(step);
          return;
        }
        animationRef.current = null;
        container.dataset.lyricSmoothReturn = "false";
        returningToLyricsRef.current = false;
        scrollDurationRef.current = LYRIC_AUTO_SCROLL_DURATION_MS;
      };
      animationRef.current = requestAnimationFrame(step);
      return () => {
        if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      };
    },
    [activeIndex, clock, displayedLines, followingActiveLyric, lyricsRef, reduceMotion, wordSynced]
  );

  useEffect(() => {
    let resumeFrame = 0;
    const resume = () => {
      if (
        document.hidden ||
        !followingActiveLyric ||
        !returningToLyricsRef.current ||
        animationRef.current !== null ||
        resumeFrame
      )
        return;
      resumeFrame = requestAnimationFrame(() => {
        resumeFrame = 0;
        centerActiveLyric();
      });
    };
    const onVisibility = () => {
      if (document.hidden) {
        returningToLyricsRef.current = true;
        if (lyricsRef.current) lyricsRef.current.dataset.lyricSmoothReturn = "true";
        cancelAnimationFrame(resumeFrame);
        resumeFrame = 0;
        if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      } else if (followingActiveLyric) {
        resume();
      }
    };
    const unsubscribe = clock.subscribe(resume);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribe();
      cancelAnimationFrame(resumeFrame);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [centerActiveLyric, clock, followingActiveLyric, lyricsRef]);

  useLayoutEffect(() => {
    const activeIndexChanged = previousActiveIndexRef.current !== activeIndex;
    previousActiveIndexRef.current = activeIndex;
    const pendingSeekIndex = pendingSeekIndexRef.current;
    if (pendingSeekIndex !== null) {
      if (activeIndexChanged && Math.abs(activeIndex - pendingSeekIndex) <= 1) {
        pendingSeekIndexRef.current = null;
        scrollDurationRef.current = LYRIC_RESYNC_SCROLL_DURATION_MS;
        setDetachedLyrics(null);
      }
      return;
    }
    return centerActiveLyric();
  }, [activeIndex, centerActiveLyric]);

  useEffect(() => {
    pendingSeekIndexRef.current = null;
  }, [lines]);

  useEffect(() => {
    const syncChanged = previousSyncVersionRef.current !== syncVersion;
    previousSyncVersionRef.current = syncVersion;
    if (!syncChanged || activeIndex < 0 || isLoading || !followingActiveLyric) return;
    scrollDurationRef.current = LYRIC_RESYNC_SCROLL_DURATION_MS;
    setDetachedLyrics(null);
    const frame = requestAnimationFrame(() => centerActiveLyric(true));
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, centerActiveLyric, followingActiveLyric, isLoading, syncVersion]);

  useEffect(() => {
    const container = lyricsRef.current;
    const scrollbar = scrollbarRef.current;
    const spacer = scrollbarSpacerRef.current;
    if (!container || !scrollbar || !spacer) return;
    const stopFollowingActiveLyric = () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      returningToLyricsRef.current = false;
      container.dataset.lyricSmoothReturn = "false";
      scrollDurationRef.current = LYRIC_AUTO_SCROLL_DURATION_MS;
      setDetachedLyrics(displayedLines);
    };
    const updateMetrics = () => {
      const height = Math.max(
        scrollbar.clientHeight + 1,
        container.scrollHeight - container.clientHeight + scrollbar.clientHeight
      );
      spacer.style.height = `${height}px`;
      if (Math.abs(scrollbar.scrollTop - container.scrollTop) > 0.5)
        scrollbar.scrollTop = container.scrollTop;
    };
    const syncScrollbar = () => {
      if (Math.abs(scrollbar.scrollTop - container.scrollTop) > 0.5)
        scrollbar.scrollTop = container.scrollTop;
    };
    const syncLyrics = () => {
      if (animationRef.current !== null || detachedLyrics !== displayedLines) return;
      if (Math.abs(container.scrollTop - scrollbar.scrollTop) > 0.5)
        container.scrollTop = scrollbar.scrollTop;
    };
    const frame = requestAnimationFrame(updateMetrics);
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(container);
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    container.addEventListener("scroll", syncScrollbar, { passive: true });
    container.addEventListener("touchstart", stopFollowingActiveLyric, { passive: true });
    container.addEventListener("wheel", stopFollowingActiveLyric, { passive: true });
    scrollbar.addEventListener("pointerdown", stopFollowingActiveLyric, { passive: true });
    scrollbar.addEventListener("scroll", syncLyrics, { passive: true });
    scrollbar.addEventListener("touchstart", stopFollowingActiveLyric, { passive: true });
    scrollbar.addEventListener("wheel", stopFollowingActiveLyric, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener("scroll", syncScrollbar);
      container.removeEventListener("touchstart", stopFollowingActiveLyric);
      container.removeEventListener("wheel", stopFollowingActiveLyric);
      scrollbar.removeEventListener("pointerdown", stopFollowingActiveLyric);
      scrollbar.removeEventListener("scroll", syncLyrics);
      scrollbar.removeEventListener("touchstart", stopFollowingActiveLyric);
      scrollbar.removeEventListener("wheel", stopFollowingActiveLyric);
    };
  }, [detachedLyrics, displayedLines, isLoading, lyricsRef, unavailable]);

  const selectLyric = (index: number, startTimeMs: number) => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    returningToLyricsRef.current = false;
    if (lyricsRef.current) lyricsRef.current.dataset.lyricSmoothReturn = "false";
    pendingSeekIndexRef.current = index === activeIndex ? null : index;
    setDetachedLyrics(index === activeIndex ? null : displayedLines);
    if (index === activeIndex && followingActiveLyric) centerActiveLyric(true);
    onSelect(Math.ceil(startTimeMs / 1000) * 1000);
  };

  const toggleTranslation = () => {
    initialLyricsPositionedRef.current = false;
    setDetachedLyrics(null);
    setSelectedTranslation(showTranslation ? null : translationLines);
  };

  return (
    <section className="relative isolate min-w-0 flex-1 overflow-hidden">
      {isLoading && (
        <div className="player-lyrics-loading" role="status">
          <div className="player-lyrics-loading-content">
            <div className="player-lyrics-flipbook"><LyricsFlipbook /></div>
            <p className="player-lyrics-loading-text text-white/80">
              {LYRICS_LOADING_MESSAGE}
            </p>
          </div>
        </div>
      )}
      <div
        className="player-lyrics-scroll player-scroll relative h-full overflow-y-auto px-10 py-8"
        data-lenis-prevent
        data-lyric-following={followingActiveLyric}
        data-lyric-synced={synced}
        data-word-synced={wordSynced}
        ref={lyricsRef}
      >
        <div className="min-h-full">
          <div
            className={
              synced ? "space-y-[38px] py-[50vh]" : "mx-auto max-w-4xl space-y-7 py-24"
            }
          >
            {unavailable ? (
              <div className="absolute inset-0 grid place-items-center px-8 text-center">
                <div className="max-w-lg space-y-2.5">
                  <p className="text-xl font-semibold tracking-tight text-white">
                    The song is here, the words aren&apos;t.
                  </p>
                  <p className="player-lyrics-empty-desc">
                    We couldn&apos;t find a reliable lyrics match.
                  </p>
                </div>
              </div>
            ) : displayedLines.length ? (
              <>
                {!synced && (
                  <h2 className="player-lyrics-unsynced-header -mb-3 flex items-center gap-2 text-lg font-medium tracking-wide">
                    <Clock3 aria-hidden="true" className="size-4" />
                    These lyrics aren’t time-synced yet.
                  </h2>
                )}
                {displayedLines.map((line, index) => (
                  <div
                    className="player-lyric-group"
                    key={`${line.startTimeMs ?? "plain"}-${index}`}
                  >
                    {wordSynced && (
                      <AccompanimentLyrics
                        line={line}
                        index={index}
                        nextStart={displayedLines[index + 1]?.startTimeMs}
                        before
                      />
                    )}
                    <p
                      aria-current={index === activeIndex ? "true" : undefined}
                      aria-label={
                        line.startTimeMs === null
                          ? undefined
                          : line.text === "" && lines[index]?.text === ""
                          ? "Seek to instrumental break"
                          : `Seek to ${line.text}`
                      }
                      className={`player-synced-lyric-line ${
                        synced
                          ? `text-[40px] font-extrabold tracking-normal leading-[1.2] ${
                              index === activeIndex
                                ? "text-white opacity-100"
                                : "text-white/40 opacity-40"
                            }`
                          : "text-[40px] font-extrabold leading-[1.2] tracking-normal"
                      } ${
                        line.startTimeMs === null
                          ? ""
                          : "cursor-pointer outline-none hover:text-white hover:opacity-100 focus-visible:text-white focus-visible:opacity-100"
                      }`}
                      data-lyric-active={index === activeIndex}
                      dir="auto"
                      data-lyric-index={index}
                      key={`${line.startTimeMs ?? "plain"}-${index}`}
                      role={line.startTimeMs === null ? undefined : "button"}
                      tabIndex={line.startTimeMs === null ? undefined : 0}
                      onClick={() => {
                        if (line.startTimeMs !== null) selectLyric(index, line.startTimeMs);
                      }}
                      onKeyDown={(event) => {
                        if (
                          line.startTimeMs !== null &&
                          (event.key === "Enter" || event.key === " ")
                        ) {
                          event.preventDefault();
                          selectLyric(index, line.startTimeMs);
                        }
                      }}
                    >
                      <LyricText line={line} wordSynced={wordSynced} />
                    </p>
                    {wordSynced && (
                      <AccompanimentLyrics
                        line={line}
                        index={index}
                        nextStart={displayedLines[index + 1]?.startTimeMs}
                        before={false}
                      />
                    )}
                  </div>
                ))}
              </>
            ) : null}
          </div>
          {!isLoading && !unavailable && credit && <LyricCredit credit={credit} />}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="player-lyrics-native-scrollbar player-scroll absolute bottom-[92px] right-0 top-0 z-10 overflow-x-hidden overflow-y-scroll"
        data-lenis-prevent
        ref={scrollbarRef}
        tabIndex={-1}
      >
        <span className="block w-px" ref={scrollbarSpacerRef} />
      </div>
      {!isLoading && !unavailable && translationLines && (
        <button
          className="absolute right-6 top-6 z-20 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          type="button"
          onClick={toggleTranslation}
        >
          {showTranslation ? "View original" : "View translation"}
        </button>
      )}
      {!isLoading && !unavailable && synced && activeIndex >= 0 && !followingActiveLyric && (
        <button
          aria-label="Center active lyrics and resume sync"
          className="absolute bottom-[56px] left-1/2 z-30 flex min-h-12 -translate-x-1/2 items-center gap-2.5 rounded-lg bg-white px-5 py-3 text-base font-bold text-black shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          type="button"
          onClick={() => {
            pendingSeekIndexRef.current = null;
            scrollDurationRef.current = LYRIC_RESYNC_SCROLL_DURATION_MS;
            setDetachedLyrics(null);
          }}
        >
          <AudioLines className="size-5" />
          Sync
        </button>
      )}
    </section>
  );
});

export const LyricsRenderer = memo(function LyricsRenderer(
  props: React.ComponentProps<typeof ExistingLyrics> & { style: "Default" | "Focus" }
) {
  if (!props.isLoading && !props.unavailable && props.type !== "PLAIN" && props.lines.length > 0) {
    return (
      <Suspense fallback={null}>
        <NativeLyricsRenderer key={props.track.trackId} {...props} focus={props.style === "Focus"} />
      </Suspense>
    );
  }
  return <ExistingLyrics {...props} />;
});

export default LyricsRenderer;
