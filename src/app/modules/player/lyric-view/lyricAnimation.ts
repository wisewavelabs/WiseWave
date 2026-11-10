import type { LyricLine } from '../../../types/lyricRenderer';
import type { PlaybackClock } from './playbackClock';
import { splitLyricGraphemes } from './renderer/textSegments';
import { createLyricScrollMotion, createLyricWordMotion, syncLyricEffect, type LyricEffect } from './lyricMotion';

const MASK_FADE_PX = 100;
const WORD_SCALE_PADDING = 1.12;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function getLyricTop(container: HTMLElement, line: HTMLElement) {
  let top = 0;
  let element: HTMLElement | null = line;
  while (element && element !== container) {
    top += element.offsetTop;
    element = element.offsetParent instanceof HTMLElement ? element.offsetParent : null;
  }
  return top;
}

export function createLyricWords(line: LyricLine) {
  const words: Array<{ units: Array<{ text: string; start: number; end: number }>; start: number; end: number }> = [];
  let boundary = true;
  let textCursor = 0;
  const hasMatchingText = (line.syllables ?? []).map(unit => unit.text).join('').replace(/\s/gu, '') === line.text.replace(/\s/gu, '');
  for (const [index, syllable] of (line.syllables ?? []).entries()) {
    const end = Math.max(syllable.startTimeMs, Math.min(syllable.endTimeMs ?? line.syllables?.[index + 1]?.startTimeMs ?? line.endTimeMs ?? syllable.startTimeMs + 150, line.syllables?.[index + 1]?.startTimeMs ?? Infinity, line.endTimeMs ?? Infinity));
    let syllableText = syllable.text;
    if (hasMatchingText) {
      const start = textCursor;
      let remaining = syllable.text.replace(/\s/gu, '').length;
      while (textCursor < line.text.length && remaining > 0) {
        if (!/\s/u.test(line.text[textCursor])) remaining--;
        textCursor++;
      }
      while (textCursor < line.text.length && /\s/u.test(line.text[textCursor])) textCursor++;
      syllableText = line.text.slice(start, textCursor);
    }
    for (const text of syllableText.match(/\s+|[^\s]+/gu) ?? []) {
      if (/^\s+$/u.test(text)) {
        const word = words.at(-1);
        if (word) word.units.at(-1)!.text += text;
        boundary = true;
        continue;
      }
      let word = words.at(-1);
      if (!word || boundary || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) {
        word = { units: [], start: syllable.startTimeMs, end: 0 };
        words.push(word);
      }
      word.units.push({ text, start: syllable.startTimeMs, end });
      word.end = end;
      boundary = false;
    }
  }
  for (const word of words) {
    let offset = 0;
    const boundaries = new Set(splitLyricGraphemes(word.units.map(unit => unit.text).join('')).map(text => {
      const start = offset;
      offset += text.length;
      return start;
    }));
    offset = 0;
    word.units = word.units.reduce<typeof word.units>((units, unit) => {
      const previous = units.at(-1);
      if (previous && !boundaries.has(offset)) {
        previous.text += unit.text;
        previous.end = Math.max(previous.end, unit.end);
      } else units.push({ ...unit });
      offset += unit.text.length;
      return units;
    }, []);
  }
  return words;
}

export interface LyricMetrics {
  lines: Array<{ top: number; height: number }>;
  height: number;
  scrollHeight: number;
}

export function findActiveLyricIndex(lines: LyricLine[], position: number, endTimes?: number[], wordSynced = true) {
  if (!wordSynced) {
    let low = 0;
    let high = lines.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((lines[middle].startTimeMs ?? Infinity) <= position) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const start = line.startTimeMs ?? Infinity;
    if (start > position) return index;
    const end = endTimes?.[index] ?? Math.max(line.endTimeMs ?? lines[index + 1]?.startTimeMs ?? Infinity,
      ...(line.accompanimentLines ?? []).map(background => background.endTimeMs ?? background.syllables?.at(-1)?.endTimeMs ?? 0));
    if (position < end) return index;
  }
  return lines.length - 1;
}

interface MeasuredUnit {
  element: HTMLElement;
  start: number;
  end: number;
  x: number;
  width: number;
  textX: number;
  textWidth: number;
  motionTarget: HTMLElement | null;
  motionStart: number;
  motionDuration: number;
  motionFrames: Keyframe[];
  motion: LyricEffect;
  wipeStart: number;
  wipeDuration: number;
  wipeFrames: Keyframe[];
  wipe: LyricEffect;
  mask: string;
  maskImage: string;
}

interface MeasuredRow {
  units: MeasuredUnit[];
  left: number;
  width: number;
  rtl: boolean;
}

export function animateLyrics({ container, clock, lines, reducedMotion, wordSynced, onActiveIndex, onMeasure }: {
  container: HTMLElement;
  clock: PlaybackClock;
  lines: LyricLine[];
  reducedMotion: boolean;
  wordSynced: boolean;
  onActiveIndex: (index: number) => void;
  onMeasure: (metrics: LyricMetrics) => void;
}) {
  let measuredLines: Array<{ element: HTMLElement; rows: MeasuredRow[]; layoutTop: number; blur: number; index: number; accompaniment: boolean; start: number; end: number }> = [];
  let frame = 0;
  let measurementFrame = 0;
  let visible = false;
  let disposed = false;
  let previousIndex = -2;
  let previousBlurFocus = '';
  let redrawAll = true;
  let previousScrollTop = container.scrollTop;
  let previousFrame = performance.now();
  let previousPosition = -1;
  let previousAdvancing = false;
  let previousReady = false;
  let containerHeight = container.clientHeight;
  const measuredWidths = new WeakMap<HTMLElement, number>();
  const scrollMotion = createLyricScrollMotion();
  const endTimes = lines.map((line, index) => Math.max(line.endTimeMs ?? lines[index + 1]?.startTimeMs ?? Infinity,
    ...(line.accompanimentLines ?? []).map(background => background.endTimeMs ?? background.syllables?.at(-1)?.endTimeMs ?? 0)));

  const draw = (now: number) => {
    frame = 0;
    if (disposed || document.hidden || !visible) return;
    const position = clock.read(now);
    const ready = clock.isReady();
    const index = ready ? findActiveLyricIndex(lines, position, endTimes, wordSynced) : -1;
    const advancing = clock.isAdvancing(now);
    const forceSync = redrawAll || ready !== previousReady || !advancing || advancing !== previousAdvancing || position < previousPosition
      || Math.abs(position - previousPosition - (now - previousFrame)) > 200;
    const scrollDelta = container.scrollTop - previousScrollTop;
    previousScrollTop = container.scrollTop;
    previousFrame = now;
    const snapPlacement = !wordSynced || reducedMotion || previousIndex === -2
      || container.dataset.lyricFollowing !== "true" || container.dataset.lyricSmoothReturn === "true";
    if (snapPlacement) scrollMotion.clear();
    else if (scrollDelta) scrollMotion.retarget(scrollDelta, index, measuredLines.filter(line => !line.accompaniment)
      .map(line => ({ element: line.element.parentElement!, index: line.index, layoutTop: line.layoutTop, height: line.element.offsetHeight })), container.scrollTop, containerHeight);
    if (index !== previousIndex) {
      if (Math.abs(index - previousIndex) > 6) redrawAll = true;
      previousIndex = index;
      onActiveIndex(index);
    }
    let focusEnd = index;
    for (let candidate = Math.max(0, index); candidate < lines.length; candidate++) {
      if ((lines[candidate].startTimeMs ?? Infinity) > position) break;
      if (position < endTimes[candidate]) focusEnd = candidate;
    }
    const blurEnabled = wordSynced && !reducedMotion && container.dataset.lyricFollowing === "true" && index >= 0;
    const blurFocus = `${index}:${focusEnd}:${blurEnabled}`;
    if (previousBlurFocus !== blurFocus) {
      previousBlurFocus = blurFocus;
      for (const measuredLine of measuredLines) {
        const lineIndex = measuredLine.index;
        const distance = Math.max(0, index - lineIndex, lineIndex - focusEnd);
        const blur = !blurEnabled || measuredLine.accompaniment ? 0 : Math.min(distance * 3, 12);
        if (measuredLine.blur !== blur) {
          measuredLine.blur = blur;
          measuredLine.element.style.setProperty("--lyric-blur", `${blur}px`);
        }
      }
    }
    for (const currentLine of measuredLines) {
      if (currentLine.accompaniment) {
        const showing = clock.isReady() && position >= currentLine.start - 600 && position <= currentLine.end + 600;
        const visibility = showing ? "true" : "false";
        const wrapper = currentLine.element.parentElement?.parentElement;
        if (wrapper && wrapper.dataset.lyricVisible !== visibility) {
          wrapper.dataset.lyricVisible = visibility;
          wrapper.ariaHidden = showing ? "false" : "true";
        }
        if (!showing) {
          for (const row of currentLine.rows) for (const unit of row.units) {
            unit.motion.animation?.cancel(); unit.motion.animation = null;
            unit.wipe.animation?.cancel(); unit.wipe.animation = null;
          }
          continue;
        }
      } else if (!redrawAll && Math.abs(currentLine.index - index) > 6) {
        for (const row of currentLine.rows) for (const unit of row.units) {
          unit.motion.animation?.cancel(); unit.motion.animation = null;
          unit.wipe.animation?.cancel(); unit.wipe.animation = null;
        }
        continue;
      }
      for (const row of currentLine.rows) {
        if (!reducedMotion && wordSynced && ready) {
          for (const unit of row.units) {
            if (unit.element.style.maskImage !== unit.maskImage) unit.element.style.maskImage = unit.maskImage;
            syncLyricEffect(unit.wipe, unit.element, unit.wipeFrames, unit.wipeDuration,
              position - unit.wipeStart, advancing, forceSync, 'maskPosition');
            if (unit.motionTarget) syncLyricEffect(unit.motion, unit.motionTarget, unit.motionFrames, unit.motionDuration,
              position - unit.motionStart, advancing, forceSync, 'transform');
          }
          continue;
        }
        const active = row.units.find((unit) => position >= unit.start && position < unit.end);
        const finished = [...row.units].reverse().find((unit) => position >= unit.end);
        const syllableProgress = active ? clamp((position - active.start) / Math.max(1, active.end - active.start)) : 0;
        const boundary = active ? active.textX + active.textWidth * (row.rtl ? 1 - syllableProgress : syllableProgress)
          : finished ? finished.textX + (row.rtl ? 0 : finished.textWidth) : row.rtl ? row.left + row.width : row.left;
        const progress = clamp((boundary - row.left) / Math.max(1, row.width));
        const fade = Math.min(MASK_FADE_PX / Math.max(1, row.width), 1);
        const center = -fade / 2 + (1 + fade) * progress;
        const start = (clamp(center - fade / 2) * 100).toFixed(2);
        const end = (clamp(center + fade / 2) * 100).toFixed(2);
        const mask = position >= (row.units.at(-1)?.end ?? 0) ? "none"
          : row.rtl ? `linear-gradient(90deg,#0003 ${start}%,#000 ${end}%)` : `linear-gradient(90deg,#000 ${start}%,#0003 ${end}%)`;
        for (const unit of row.units) {
          if (unit.mask !== mask) { unit.element.style.setProperty("--lyric-mask", mask); unit.mask = mask; }
          unit.wipe.animation?.cancel(); unit.wipe.animation = null;
          unit.wipe.settled = false;
          unit.motion.animation?.cancel(); unit.motion.animation = null;
          unit.motion.settled = false;
          unit.element.style.removeProperty('mask-image');
          unit.element.style.removeProperty('mask-position');
          unit.motionTarget?.style.removeProperty('transform');
        }
      }
    }
    redrawAll = false;
    previousPosition = position;
    previousAdvancing = advancing;
    previousReady = ready;
    if (advancing) frame = requestAnimationFrame(draw);
  };

  const wake = () => {
    if (!frame && visible && !document.hidden && !disposed) frame = requestAnimationFrame(draw);
  };
  const updatePlacement = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    draw(performance.now());
  };
  const measure = () => {
    measurementFrame = 0;
    if (disposed) return;
    for (const line of measuredLines) for (const row of line.rows) for (const unit of row.units) {
      unit.motion.animation?.cancel(); unit.wipe.animation?.cancel();
      unit.motionTarget?.style.removeProperty('transform');
    }
    const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-lyric-index], [data-lyric-accompaniment]"));
    for (const element of elements) {
      if (measuredWidths.get(element) === element.clientWidth) continue;
      measuredWidths.set(element, element.clientWidth);
      const words = Array.from(element.querySelectorAll<HTMLElement>(".player-lyric-word"));
      for (const word of words) word.style.removeProperty("font-size");
      const availableWidth = element.clientWidth / WORD_SCALE_PADDING;
      if (availableWidth <= 0) continue;
      const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
      for (const word of words) {
        const width = word.offsetWidth;
        if (width > availableWidth) word.style.fontSize = `${fontSize * availableWidth / width}px`;
      }
    }
    const containerStyle = getComputedStyle(container);
    const layoutHeight = (container.firstElementChild as HTMLElement | null)?.offsetHeight ?? container.scrollHeight;
    const scrollHeight = Math.max(container.clientHeight, layoutHeight + (Number.parseFloat(containerStyle.paddingTop) || 0) + (Number.parseFloat(containerStyle.paddingBottom) || 0));
    const metrics: LyricMetrics = { lines: [], height: container.clientHeight, scrollHeight };
    containerHeight = metrics.height;
    const previousLines = new Map(measuredLines.map(line => [line.element, line]));
    measuredLines = elements.map((element) => {
      const accompaniment = element.hasAttribute("data-lyric-accompaniment");
      const previousTransform = element.style.transform;
      const previousTransition = element.style.transition;
      if (accompaniment) { element.style.transition = "none"; element.style.transform = "none"; }
      const index = Number(element.dataset.lyricIndex ?? element.dataset.lyricAccompaniment);
      const layoutTop = getLyricTop(container, element);
      if (!accompaniment) metrics.lines[index] = { top: layoutTop, height: element.offsetHeight };
      const rows = new Map<HTMLElement, MeasuredUnit[]>();
      const rtl = getComputedStyle(element).direction === "rtl";
      element.dataset.lyricDirection = rtl ? "rtl" : "ltr";
      const unitElements = Array.from(element.querySelectorAll<HTMLElement>("[data-lyric-unit]"));
      const transforms = unitElements.map(unit => unit.style.transform);
      for (const unit of unitElements) unit.style.transform = "none";
      const lineLeft = element.getBoundingClientRect().left;
      const wordBounds = new Map<HTMLElement, DOMRect>();
      const transformOrigins: string[] = [];
      for (const unitElement of unitElements) {
        const word = unitElement.closest<HTMLElement>('.player-lyric-word')!;
        const bounds = unitElement.getBoundingClientRect();
        let wordRect = wordBounds.get(word);
        if (!wordRect) { wordRect = word.getBoundingClientRect(); wordBounds.set(word, wordRect); }
        const style = getComputedStyle(unitElement);
        const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
        const paddingRight = Number.parseFloat(style.paddingRight) || 0;
        const wordStart = Number(word.dataset.start);
        const wordEnd = Number(word.dataset.end);
        const characterIndex = Number(unitElement.dataset.characterIndex);
        const characterCount = Number(word.dataset.characterCount);
        const durationMs = Math.max(1, wordEnd - wordStart);
        const motion = createLyricWordMotion(word.textContent ?? '', durationMs, characterCount, characterIndex, accompaniment);
        const unit: MeasuredUnit = {
          element: unitElement, start: Number(unitElement.dataset.start), end: Number(unitElement.dataset.end),
          x: bounds.left - lineLeft, width: bounds.width,
          textX: bounds.left - lineLeft + paddingLeft,
          textWidth: Math.max(0, bounds.width - paddingLeft - paddingRight),
          motionTarget: motion.character ? unitElement.parentElement : null,
          motionStart: wordStart + motion.delay, motionDuration: motion.duration, motionFrames: motion.frames,
          motion: { animation: null, settled: false }, wipe: { animation: null, settled: false },
          wipeStart: wordStart, wipeDuration: durationMs, wipeFrames: [], mask: '', maskImage: '',
        };
        transformOrigins.push(`${wordRect.left + wordRect.width / 2 - bounds.left}px 100%`);
        const row = rows.get(word) ?? [];
        row.push(unit);
        rows.set(word, row);
      }
      for (const [unitIndex, unitElement] of unitElements.entries()) {
        if (unitElement.style.transformOrigin !== transformOrigins[unitIndex]) unitElement.style.transformOrigin = transformOrigins[unitIndex];
        unitElement.style.transform = transforms[unitIndex];
      }
      const previous = previousLines.get(element);
      if (accompaniment) { element.style.transform = previousTransform; element.style.transition = previousTransition; }
      return { element, index, accompaniment, layoutTop, start: Number(element.dataset.start), end: Number(element.dataset.end), blur: previous?.blur ?? -1, rows: [...rows.values()].map((units) => {
        const left = Math.min(...units.map((unit) => unit.x));
        const width = Math.max(...units.map((unit) => unit.x + unit.width)) - left;
        return { units, left, width, rtl };
      }) };
    });
    for (const line of measuredLines) {
      for (const row of line.rows) {
        const width = Math.max(1, row.width);
        const word = row.units[0].element.closest<HTMLElement>('.player-lyric-word')!;
        const fontSize = Number.parseFloat(getComputedStyle(word).fontSize);
        const cjk = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/u.test(word.textContent ?? '');
        const feather = fontSize * (cjk ? .3 : .75 + .45 * clamp((Array.from((word.textContent ?? '').trim()).length - 6) / 10));
        const stops = [{ offset: 0, edge: 0 }];
        let edge = 0;
        for (const unit of row.units) {
          stops.push({ offset: clamp((unit.start - unit.wipeStart) / unit.wipeDuration), edge });
          edge += unit.textWidth;
          stops.push({ offset: clamp((unit.end - unit.wipeStart) / unit.wipeDuration), edge });
        }
        stops.push({ offset: 1, edge: Math.max(1, edge) });
        const distance = Math.max(1, edge);
        for (const unit of row.units) {
          const maskSize = `${reducedMotion ? width : width * 2 + feather}px 100%`;
          const offset = unit.x - row.left;
          unit.wipeFrames = stops.map(stop => ({ offset: stop.offset,
            maskPosition: `${row.rtl ? -offset - stop.edge / distance * (width + feather) : -offset - width - feather + stop.edge / distance * (width + feather)}px 0` }));
          const maskPosition = reducedMotion ? `${-offset}px 0` : String(unit.wipeFrames[0].maskPosition);
          unit.maskImage = row.rtl
            ? `linear-gradient(90deg,#0003 ${width}px,#000 ${width + feather}px)`
            : `linear-gradient(90deg,#000 ${width}px,#0003 ${width + feather}px)`;
          if (!reducedMotion) unit.element.style.maskImage = unit.maskImage;
          if (unit.element.style.maskSize !== maskSize) unit.element.style.maskSize = maskSize;
          if (unit.element.style.maskPosition !== maskPosition) unit.element.style.maskPosition = maskPosition;
        }
      }
    }
    redrawAll = true;
    previousBlurFocus = '';
    onMeasure(metrics);
    wake();
  };
  const scheduleMeasurement = () => {
    if (!measurementFrame && !disposed) measurementFrame = requestAnimationFrame(measure);
  };
  const onFontsLoaded = () => {
    for (const line of measuredLines) measuredWidths.delete(line.element);
    scheduleMeasurement();
  };
  const resizeObserver = new ResizeObserver(scheduleMeasurement);
  resizeObserver.observe(container);
  if (container.firstElementChild) resizeObserver.observe(container.firstElementChild);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (!visible) {
      cancelAnimationFrame(frame); frame = 0;
      for (const line of measuredLines) for (const row of line.rows) for (const unit of row.units) {
        unit.motion.animation?.pause(); unit.wipe.animation?.pause();
      }
    } else { redrawAll = true; wake(); }
  });
  intersectionObserver.observe(container);
  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame); frame = 0;
      scrollMotion.clear();
      for (const line of measuredLines) for (const row of line.rows) for (const unit of row.units) {
        unit.motion.animation?.pause(); unit.wipe.animation?.pause();
      }
    }
    else {
      redrawAll = true;
      previousFrame = performance.now();
      previousScrollTop = container.scrollTop;
      wake();
    }
  };
  const unsubscribe = clock.subscribe(wake);
  document.addEventListener("visibilitychange", onVisibility);
  container.addEventListener("scroll", wake, { passive: true });
  container.addEventListener("lyricresync", updatePlacement);
  document.fonts.addEventListener("loadingdone", onFontsLoaded);
  void document.fonts.ready.then(onFontsLoaded);
  measure();
  return () => {
    disposed = true;
    scrollMotion.clear();
    cancelAnimationFrame(frame);
    cancelAnimationFrame(measurementFrame);
    unsubscribe();
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    container.removeEventListener("scroll", wake);
    container.removeEventListener("lyricresync", updatePlacement);
    for (const line of measuredLines) {
      if (!line.accompaniment) line.element.parentElement?.style.removeProperty("--lyric-offset");
      for (const word of line.element.querySelectorAll<HTMLElement>(".player-lyric-word")) word.style.removeProperty("font-size");
      line.element.style.removeProperty("--lyric-blur");
      for (const row of line.rows) for (const unit of row.units) {
        unit.motion.animation?.cancel(); unit.wipe.animation?.cancel();
        unit.motionTarget?.style.removeProperty('transform');
        unit.element.style.removeProperty('mask-image');
        unit.element.style.removeProperty('mask-position');
        unit.element.style.removeProperty('mask-size');
        unit.element.style.removeProperty("--lyric-mask");
        unit.element.style.removeProperty("transform");
        unit.element.style.removeProperty("transform-origin");
      }
    }
    document.fonts.removeEventListener("loadingdone", onFontsLoaded);
  };
}
