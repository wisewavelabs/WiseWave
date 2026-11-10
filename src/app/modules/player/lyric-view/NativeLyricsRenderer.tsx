"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines } from "lucide-react";
import type { LyricLine, LyricsType, Track } from "../../../types/lyricRenderer";
import type { PlaybackClock } from "./playbackClock";
import { createLyricWords, findActiveLyricIndex } from "./lyricAnimation";

interface RendererSyllable {
  text: string;
  timestamp: number;
  endtime: number;
  part: boolean;
  lineSynced: boolean;
}

interface RendererLine {
  text: RendererSyllable[];
  background: boolean;
  backgroundText: RendererSyllable[];
  oppositeTurn: boolean;
  timestamp: number;
  endtime: number;
  isWordSynced: boolean;
}

interface LyricsElement extends HTMLElement {
  currentTime: number;
  reducedMotion: boolean;
  updateComplete: Promise<boolean>;
  resumeFollowing: () => void;
  findInstrumentalGapAt: (time: number) => { insertBeforeIndex: number } | null;
}

let rendererPromise: Promise<void> | undefined;

function loadRenderer() {
  if (customElements.get("wisewave-lyrics")) return Promise.resolve();
  if (rendererPromise) return rendererPromise;
  rendererPromise = import("./renderer/lyricsRuntime")
    .then(() => {
      if (customElements.get("wisewave-lyrics")) return;
      const Renderer = customElements.get("am-lyrics");
      if (!Renderer) throw new Error("Lyrics renderer unavailable");
      class LocalLyrics extends Renderer {
        fetchLyrics() {
          return Promise.resolve();
        }
      }
      customElements.define("wisewave-lyrics", LocalLyrics);
    })
    .catch((error) => {
      rendererPromise = undefined;
      throw error;
    });
  return rendererPromise;
}

function buildSyllables(line: LyricLine, end: number, wordSynced: boolean): RendererSyllable[] {
  if (!wordSynced || !line.syllables?.length || !line.text.trim() || line.text.trim() === "♪") {
    return [
      {
        text: line.text.trim() ? line.text : "♪",
        timestamp: line.startTimeMs ?? 0,
        endtime: end,
        part: false,
        lineSynced: true,
      },
    ];
  }
  return createLyricWords(line)
    .flatMap((word) => word.units)
    .map((unit) => ({
      text: unit.text,
      timestamp: unit.start,
      endtime: unit.end,
      part: !/\s$/u.test(unit.text),
      lineSynced: false,
    }));
}

function buildLines(lines: LyricLine[], wordSynced: boolean, duration: number): RendererLine[] {
  const normalized: LyricLine[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.text.trim()) {
      normalized.push(line);
      continue;
    }
    const empty = { ...line, endTimeMs: lines[index + 1]?.startTimeMs ?? duration };
    const previous = normalized[normalized.length - 1];
    if (previous && !previous.text.trim()) {
      previous.endTimeMs = empty.endTimeMs;
      previous.accompanimentLines = [
        ...(previous.accompanimentLines ?? []),
        ...(empty.accompanimentLines ?? []),
      ];
    } else normalized.push(empty);
  }
  return normalized.map((line, index) => {
    const end =
      line.endTimeMs ??
      line.syllables?.[line.syllables.length - 1]?.endTimeMs ??
      normalized[index + 1]?.startTimeMs ??
      duration;
    const backgroundText = (line.accompanimentLines ?? []).flatMap((background) =>
      buildSyllables(
        background,
        background.endTimeMs ??
          background.syllables?.[background.syllables.length - 1]?.endTimeMs ??
          end,
        wordSynced
      )
    );
    return {
      text: buildSyllables(line, end, wordSynced),
      background: backgroundText.length > 0,
      backgroundText,
      oppositeTurn: false,
      timestamp: line.startTimeMs ?? 0,
      endtime: end,
      isWordSynced: wordSynced,
    };
  });
}

export default function NativeLyricsRenderer({
  clock,
  lines,
  onSelect,
  track,
  translationLines,
  type,
  focus = false,
}: {
  clock: PlaybackClock;
  lines: LyricLine[];
  onSelect: (positionMs: number) => void;
  track: Track;
  translationLines: LyricLine[] | null;
  type: LyricsType;
  focus?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<LyricsElement | null>(null);
  const selectRef = useRef(onSelect);
  const [translation, setTranslation] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  const displayedLines = translation && translationLines ? translationLines : lines;
  const wordSynced = type === "SYLLABLE_SYNCED" && !translation && !focus;

  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let wasAdvancing = false;
    let element: LyricsElement | undefined;
    let focusIndex = "";

    const updateFocus = () => {
      if (!focus || !element?.shadowRoot) return;
      const time = clock.read();
      const gap = element.findInstrumentalGapAt(time);
      const index = findActiveLyricIndex(displayedLines, time, undefined, false);
      const position = gap ? `gap:${gap.insertBeforeIndex}` : `line:${index}`;
      if (position === focusIndex) return;
      const rows = element.shadowRoot.querySelectorAll<HTMLElement>(".lyrics-line:not(.lyrics-gap):not(.lyrics-footer)");
      if (!rows.length) return;
      focusIndex = position;
      rows.forEach((row, lineIndex) => {
        const distance = gap
          ? lineIndex < gap.insertBeforeIndex ? gap.insertBeforeIndex - lineIndex : lineIndex - gap.insertBeforeIndex + 1
          : Math.abs(lineIndex - index);
        row.style.setProperty("--focus-opacity", String(distance === 0 ? 1 : Math.max(0.4 - 0.12 * (distance - 1), 0.08)));
        row.style.setProperty("--focus-scale", String(distance === 0 ? 1 : Math.max(0.8 - 0.04 * (distance - 1), 0.6)));
      });
    };

    const updateWordPlayback = (advancing: boolean) => {
      for (const child of Array.from(element?.shadowRoot?.children ?? [])) {
        for (const animation of (child as Element).getAnimations({ subtree: true })) {
          const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
          if (!(target instanceof Element) || !target.closest(".lyrics-word, .lyrics-syllable")) continue;
          if (advancing && animation.playState === "paused") animation.play();
          else if (!advancing && animation.playState === "running") animation.pause();
        }
      }
    };

    const tick = () => {
      frame = 0;
      if (disposed || !element || document.hidden) return;
      if (clock.isReady()) element.currentTime = clock.read();
      updateFocus();
      const advancing = clock.isAdvancing();
      if (advancing !== wasAdvancing || !advancing) updateWordPlayback(advancing);
      wasAdvancing = advancing;
      if (advancing) frame = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (!disposed && !frame && !document.hidden) frame = requestAnimationFrame(tick);
    };

    const onMotionChange = (event: Event) => {
      if (element) element.reducedMotion = Boolean((event as CustomEvent<{ motion?: boolean }>).detail?.motion);
    };

    const onVisibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (document.hidden) {
        updateWordPlayback(false);
        wasAdvancing = false;
      } else wake();
    };

    const onLineClick = (event: Event) => {
      const timestamp = (event as CustomEvent<{ timestamp?: unknown }>).detail?.timestamp;
      if (typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp >= 0) {
        selectRef.current(timestamp);
      }
    };

    const onFollowingChange = (event: Event) => {
      const enabled = (event as CustomEvent<{ following?: unknown }>).detail?.following;
      if (typeof enabled === "boolean") setFollowing(enabled);
    };

    const unsubscribe = clock.subscribe(wake);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("wisewave-settings-changed", onMotionChange);

    void loadRenderer()
      .then(async () => {
        if (disposed || !hostRef.current) return;
        setFailed(false);
        setFollowing(true);

        const renderer = document.createElement("wisewave-lyrics") as LyricsElement;
        element = renderer;
        rendererRef.current = renderer;

        Object.assign(renderer, {
          reducedMotion: document.documentElement.dataset.motion === "reduce",
          noAutoAlternates: true,
          noBlur: true,
          autoScroll: true,
          interpolate: true,
          isLoading: false,
          lyrics: buildLines(displayedLines, wordSynced, track.duration),
          currentTime: clock.isReady() ? clock.read() : 0,
        });

        renderer.setAttribute("highlight-color", "#fff");
        renderer.setAttribute("data-lenis-prevent", "");
        renderer.style.cssText =
          "display:block;height:100%;width:100%;font-family:inherit;font-weight:800;";
        renderer.addEventListener("line-click", onLineClick);
        renderer.addEventListener("lyric-following-change", onFollowingChange);

        hostRef.current.append(renderer);
        await renderer.updateComplete;
        if (disposed) return;

        if (focus) renderer.shadowRoot?.querySelector(".lyrics-container")?.classList.add("focus-mode");

        const style = document.createElement("style");
        style.textContent =
          ".lyrics-footer{visibility:hidden;pointer-events:none}:host .lyrics-container{height:100%;max-height:100%;background:transparent;--lyplus-font-size-base:var(--lyrics-font-size,40px);--lyplus-padding-line:0px;--am-lyrics-inline-padding:40px;--am-lyrics-line-spacing:38px;--am-lyrics-line-height:1.2}";
        renderer.shadowRoot?.append(style);

        if (clock.isReady()) renderer.currentTime = clock.read();
        renderer.resumeFollowing();
        wake();
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("wisewave-settings-changed", onMotionChange);
      element?.removeEventListener("line-click", onLineClick);
      element?.removeEventListener("lyric-following-change", onFollowingChange);
      element?.remove();
      if (rendererRef.current === element) rendererRef.current = null;
    };
  }, [clock, displayedLines, focus, retry, track.duration, track.trackId, wordSynced]);

  return (
    <section className="native-lyrics">
      <div className="native-lyrics-host" ref={hostRef} />
      {failed && (
        <div className="native-lyrics-error">
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Lyrics couldn’t load. Try again.
          </button>
        </div>
      )}
      {translationLines && (
        <button
          className="native-lyrics-translation"
          type="button"
          onClick={() => setTranslation((value) => !value)}
        >
          {translation ? "View original" : "View translation"}
        </button>
      )}
      {!following && !failed && (
        <button
          aria-label="Center active lyrics and resume sync"
          className="native-lyrics-sync"
          type="button"
          onClick={() => {
            const renderer = rendererRef.current;
            if (!renderer || !clock.isReady()) return;
            renderer.currentTime = clock.read();
            renderer.resumeFollowing();
          }}
        >
          <AudioLines className="size-5" />
          Sync
        </button>
      )}
    </section>
  );
}
