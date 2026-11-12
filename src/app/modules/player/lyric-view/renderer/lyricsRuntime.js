import {
  ReactiveElement,
  html,
  svg,
  decorate,
  property,
  state,
  query,
} from "./renderCore.js";
import { lyricStyles } from "./lyricStyles.js";
import { splitLyricGraphemes } from "./textSegments";
const LYRIC_MANUAL_SCROLL_SETTLE_MS = 140;

const CONFIG = {
  GOOGLE: {
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 1000,
    FETCH_TIMEOUT_MS: 6000,
  },
};
class GoogleService {
  static delay(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  static fetchWithTimeout(url, timeoutMs = CONFIG.GOOGLE.FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
  }
  static isPurelyLatinScript(text) {
    return /^[\u0000-\u007F\u0080-\u00FF\u0100-\u017F\u0180-\u024F]*$/.test(
      text,
    );
  }
  static async translate(textOrArray, targetLang) {
    if (
      !textOrArray ||
      (Array.isArray(textOrArray) && textOrArray.length === 0)
    ) {
      return Array.isArray(textOrArray) ? [] : "";
    }
    const isArray = Array.isArray(textOrArray);
    const texts = isArray ? textOrArray : [textOrArray];
    const nonEmptyIndices = [];
    const textsToTranslate = [];
    texts.forEach((t, i) => {
      if (t && t.trim()) {
        nonEmptyIndices.push(i);
        textsToTranslate.push(t);
      }
    });
    if (textsToTranslate.length === 0) {
      return isArray ? texts : texts[0];
    }
    const BATCH_SIZE_CHARS = 1500;
    const translatedResults = new Array(textsToTranslate.length).fill("");
    let currentBatch = [];
    let currentBatchIndices = [];
    let currentBatchLength = 0;
    const processBatch = async (batch, indices) => {
      if (batch.length === 0) return;
      const joinedText = batch.join("\n");
      let attempt = 0;
      let success = false;
      while (attempt < CONFIG.GOOGLE.MAX_RETRIES && !success) {
        try {
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(joinedText)}`;
          const response = await GoogleService.fetchWithTimeout(url);
          if (!response.ok) throw new Error(`Status ${response.status}`);
          const data = await response.json();
          const fullTranslation =
            data?.[0]?.map((seg) => seg?.[0]).join("") || "";
          const lines = fullTranslation.split("\n");
          indices.forEach((originalIdx, i) => {
            if (i < lines.length) {
              translatedResults[originalIdx] = lines[i];
            } else {
              translatedResults[originalIdx] = batch[i];
            }
          });
          success = true;
        } catch (e) {
          attempt += 1;
          if (attempt < CONFIG.GOOGLE.MAX_RETRIES) {
            await GoogleService.delay(
              CONFIG.GOOGLE.RETRY_DELAY_MS * 2 ** (attempt - 1),
            );
          } else {
            indices.forEach((originalIdx, i) => {
              translatedResults[originalIdx] = batch[i];
            });
          }
        }
      }
    };
    for (let i = 0; i < textsToTranslate.length; i += 1) {
      const text = textsToTranslate[i];
      if (currentBatchLength + text.length > BATCH_SIZE_CHARS) {
        await processBatch(currentBatch, currentBatchIndices);
        currentBatch = [];
        currentBatchIndices = [];
        currentBatchLength = 0;
      }
      currentBatch.push(text);
      currentBatchIndices.push(i);
      currentBatchLength += text.length;
    }
    if (currentBatch.length > 0) {
      await processBatch(currentBatch, currentBatchIndices);
    }
    const finalArray = [...texts];
    nonEmptyIndices.forEach((realIdx, mappedIdx) => {
      finalArray[realIdx] = translatedResults[mappedIdx];
    });
    return isArray ? finalArray : finalArray[0];
  }
  static async romanize(originalLyrics) {
    const lines = Array.isArray(originalLyrics)
      ? originalLyrics
      : originalLyrics.data || originalLyrics.content || [];
    if (!lines || lines.length === 0)
      return Array.isArray(originalLyrics) ? originalLyrics : [];
    const isWordSynced = lines.some(
      (l) =>
        l.isWordSynced !== false && Array.isArray(l.text) && l.text.length > 1,
    );
    if (isWordSynced) {
      return this.romanizeWordSynced(lines);
    }
    return this.romanizeLineSynced(lines);
  }
  static async romanizeWordSynced(lines) {
    return Promise.all(
      lines.map(async (line) => {
        if (
          !line.text ||
          !Array.isArray(line.text) ||
          line.text.length === 0 ||
          line.romanizedText
        )
          return line;
        const fullText = line.text.map((s) => s.text).join("");
        const [romanizedFullLine] = await this.romanizeTexts([fullText]);
        const newSyllabus = line.text.map((s) => ({
          ...s,
          romanizedText: s.romanizedText,
        }));
        return {
          ...line,
          text: newSyllabus,
          romanizedText: romanizedFullLine || "",
        };
      }),
    );
  }
  static async romanizeLineSynced(lines) {
    const linesToRomanize = lines.map((line) => {
      if (line.romanizedText) {
        return "";
      }
      if (Array.isArray(line.text) && line.text.length > 0) {
        return line.text.map((s) => s.text).join("");
      }
      return "";
    });
    const romanizedLines = await this.romanizeTexts(linesToRomanize);
    return lines.map((line, index) => ({
      ...line,
      romanizedText: romanizedLines[index] || "",
    }));
  }
  static async romanizeTexts(texts) {
    const contextText = texts.join(" ");
    if (GoogleService.isPurelyLatinScript(contextText)) {
      return texts;
    }
    const romanizedTexts = [];
    for (const text of texts) {
      if (!text || GoogleService.isPurelyLatinScript(text)) {
        romanizedTexts.push(text);
      } else {
        let attempt = 0;
        let success = false;
        let lastError = null;
        while (attempt < CONFIG.GOOGLE.MAX_RETRIES && !success) {
          try {
            const romanizeUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=rm&q=${encodeURIComponent(text)}`;
            const response = await GoogleService.fetchWithTimeout(romanizeUrl);
            const data = await response.json();
            const romanized = data?.[0]?.[0]?.[3] || text;
            romanizedTexts.push(romanized);
            success = true;
          } catch (error) {
            lastError = error;
            console.warn(
              `GoogleService: Error romanizing text "${text}" (attempt ${attempt + 1}/${CONFIG.GOOGLE.MAX_RETRIES}):`,
              error,
            );
            attempt += 1;
            if (attempt < CONFIG.GOOGLE.MAX_RETRIES) {
              await GoogleService.delay(
                CONFIG.GOOGLE.RETRY_DELAY_MS * 2 ** (attempt - 1),
              );
            }
          }
        }
        if (!success) {
          console.error(
            `GoogleService: Failed to romanize text "${text}" after ${CONFIG.GOOGLE.MAX_RETRIES} attempts. Last error:`,
            lastError,
          );
          romanizedTexts.push(text);
        }
      }
    }
    return romanizedTexts;
  }
}
const VERSION = "1.8.1";
const INSTRUMENTAL_THRESHOLD_MS = 7000;
const FETCH_TIMEOUT_MS = 8000;
const LRC_RED_TIMEOUT_MS = 3000;
const SEEK_THRESHOLD_MS = 500;
const SCROLL_ANIMATION_DURATION_MS = 350;
const BACKGROUND_TRANSITION_DURATION_MS = 600;
const BACKGROUND_VISIBILITY_MARGIN_MS = 600;
const GAP_PULSE_DURATION_MS = 4000;
const GAP_ENTRY_FADE_MS = 160;
const GAP_ENTRY_SCALE_MS = 400;
const GAP_COLLAPSE_LEAD_MS = 500;
const GAP_EXIT_LEAD_MS = SCROLL_ANIMATION_DURATION_MS;
const GAP_EXIT_TRAIL_MS = 250;
const GAP_BREATH_MIN_SCALE = 0.85;
const GAP_BREATH_MAX_SCALE = 1.12;
const GAP_EXIT_POP_SCALE = 1.2;
const GAP_EXIT_POP_PROGRESS = 0.35;
const NEXT_WORD_PRE_WIPE_MAX_GAP_MS = 180;
const NEXT_WORD_PRE_WIPE_MIN_DURATION_MS = 80;
const NEXT_WORD_PRE_WIPE_MAX_DURATION_MS = 240;
const BASE_WIPE_GRADIENT_EM = 0.75;
const CJK_WIPE_GRADIENT_EM = 0.3;
const LONG_WORD_WIPE_EXTRA_EM = 0.45;
const LONG_WORD_WIPE_EXTRA_RATIO = 0.35;
const WORD_PRE_WIPE_HANDOFF_LEAD_MS = 100;
const NEXT_LINE_BASE_BLUR_EM = 0.02;
const NEXT_LINE_UNBLUR_DURATION_MS = 2000;
function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));
}
const KPOE_SERVERS = [
  "https://lyricsplus.binimum.org",
  "https://lyricsplus-seven.vercel.app",
  "https://lyricsplus.prjktla.workers.dev",
  "https://lyrics-plus-backend.vercel.app",
];
const DEFAULT_KPOE_SOURCE_ORDER =
  "apple,lyricsplus,musixmatch,spotify,qq,deezer,musixmatch-word";
const GENIUS_WORKER_URL = "https://fetch-genius.samidy.workers.dev/";
class LyricsRuntime extends ReactiveElement {
  constructor() {
    super(...arguments);
    this.highlightColor = "#ffffff";
    this.autoScroll = true;
    this.interpolate = true;
    this.noAutoAlternates = false;
    this.noBlur = false;
    this.hidePlayedLines = false;
    this.reducedMotion = false;
    this.lineMotion = "staggered";
    this.systemReducedMotion = false;
    this.handleMotionPreference = (event) => {
      this.systemReducedMotion = event.matches;
    };
    this.showRomanization = false;
    this.showTranslation = false;
    this._currentTime = 0;
    this.rewindingLines = new Set();
    this.rewindFrame = 0;
    this.rewindEffects = [];
    this.isLoading = false;
    this.activeLineIndices = [];
    this.lineHighlightEnds = [];
    this.backgroundWraps = new WeakMap();
    this.lyricsSource = null;
    this.availableSources = [];
    this.currentSourceIndex = 0;
    this.isFetchingAlternatives = false;
    this.hasFetchedAllProviders = false;
    this.lastInstrumentalIndex = null;
    this.isUserScrolling = false;
    this.isProgrammaticScroll = false;
    this.isClickSeeking = false;
    this.cachedLyricsLines = [];
    this.cachedLineArray = [];
    this.lineElementCache = new Map();
    this.gapElementCache = new Map();
    this.gapAnimations = new Map();
    this.gapDotCache = new WeakMap();
    this.gapExitDurationCache = new WeakMap();
    this.gapCollapseDurationCache = new WeakMap();
    this.cachedAllGaps = [];
    this.cachedIsUnsynced = false;
    this.cachedLineData = null;
    this.activeLineIds = new Set();
    this.currentPrimaryActiveLine = null;
    this.lastPrimaryActiveLine = null;
    this.backgroundExpandedLines = new Set();
    this.backgroundAnimations = new Map();
    this.contentSprings = new Map();
    this.currentScrollOffset = 0;
    this.lastActiveIndex = 0;
    this.visibleLineIds = new Set();
    this.preActiveLineElements = [];
    this.progressiveBlurLine = null;
    this.positionedLineElements = [];
    this.activeGapLineElements = [];
    this._boundHandleUserScroll = this.handleUserScroll.bind(this);
    this._boundHandleViewportSync = this.scheduleViewportSync.bind(this);
    this.pendingLayoutOffsets = new Map();
    this.lineSprings = new Map();
  }
  get shouldReduceMotion() {
    return this.reducedMotion || this.systemReducedMotion;
  }
  async applyRomanization() {
    if (this.noAutoAlternates) return;
    if (this.showRomanization && this.lyrics) {
      const needsRomanization = this.lyrics.some(
        (l) =>
          !l.romanizedText && (!l.text || !l.text.some((s) => s.romanizedText)),
      );
      if (needsRomanization) {
        this.isLoading = true;
        try {
          const romanizedLines = await GoogleService.romanize(this.lyrics);
          this.lyrics = romanizedLines;
        } catch (e) {
          console.error("Romanization failed", e);
        } finally {
          this.isLoading = false;
        }
      }
    }
  }
  async applyTranslation() {
    if (this.noAutoAlternates) return;
    if (this.showTranslation && this.lyrics) {
      const needsTranslation = this.lyrics.some((l) => !l.translation);
      if (needsTranslation) {
        this.isLoading = true;
        try {
          const textToTranslate = this.lyrics.map((line) => {
            if (line.translation) return "";
            return line.text.map((s) => s.text).join("");
          });
          if (textToTranslate.every((t) => !t)) {
            this.isLoading = false;
            return;
          }
          const result = await GoogleService.translate(textToTranslate, "en");
          const translations = Array.isArray(result) ? result : [result];
          const newLyrics = this.lyrics.map((line, index) => {
            if (line.translation) return line;
            return {
              ...line,
              translation: translations[index] || undefined,
            };
          });
          this.lyrics = newLyrics;
        } catch (e) {
          console.error("Translation failed", e);
        } finally {
          this.isLoading = false;
        }
      }
    }
  }
  finishLineRewind() {
    cancelAnimationFrame(this.rewindFrame);
    this.rewindFrame = 0;
    for (const { animation } of this.rewindEffects) {
      if (
        animation.playState !== "idle" &&
        Number(animation.currentTime) <
          Number(animation.effect?.getComputedTiming().endTime)
      ) {
        const time = animation.currentTime;
        animation.play();
        animation.currentTime = time;
      }
    }
    this.rewindEffects = [];
    for (const line of this.rewindingLines)
      line
        .querySelectorAll(".shared-word-wipe")
        .forEach((fragment) => fragment.style.removeProperty("transition"));
    this.rewindingLines.clear();
  }
  startLineRewind(lines, targetTime) {
    this.finishLineRewind();
    this.rewindingLines = new Set(lines);
    for (const line of lines) {
      for (const word of LyricsRuntime.motionWords.get(line) || []) {
        if (
          word.wipe &&
          targetTime < word.wipe.end &&
          (word.wipe.settled ||
            word.wipe.animations.some(
              (animation) => animation.playState === "idle",
            ))
        )
          LyricsRuntime.startWordWipe(
            word.wipe,
            word.wipe.end,
            word.wipe.epoch,
            true,
          );
      }
      for (const syllable of LyricsRuntime.motionSyllables.get(line) || []) {
        const parameters = LyricsRuntime.motionParameters.get(syllable);
        for (const char of parameters?.chars || []) {
          const entry = LyricsRuntime.characterAnimations.get(char);
          if (entry?.settled && targetTime < entry.start + entry.end)
            LyricsRuntime.resumeCharacterMotion(char, entry.end);
        }
      }
    }
    lines
      .flatMap((line) =>
        line.getAnimations({
          subtree: true,
        }),
      )
      .forEach((animation) => {
        const effect = animation.effect;
        const target = effect?.target;
        if (!(target instanceof HTMLElement)) return;
        const name =
          "animationName" in animation ? String(animation.animationName) : "";
        const syllable = target.closest(".lyrics-syllable");
        let to;
        const wipeEpoch = LyricsRuntime.wipeClocks.get(animation);
        if (wipeEpoch !== undefined) {
          to = targetTime - wipeEpoch;
        } else if (name.includes("wipe") && syllable) {
          to =
            targetTime -
            Number(syllable.dataset.startTime) +
            Number(effect.getTiming().delay);
        } else {
          const char = target.classList.contains("char-motion")
            ? target.querySelector(".char")
            : target;
          const entry = char && LyricsRuntime.characterAnimations.get(char);
          if (!entry || entry.animation !== animation) return;
          to = targetTime - entry.start;
        }
        const end = Number(effect.getComputedTiming().endTime);
        this.rewindEffects.push({
          animation,
          from: Number(animation.currentTime || 0),
          to: Math.min(to, end),
        });
        animation.pause();
      });
    lines.forEach((line) =>
      line
        .querySelectorAll(".lyrics-syllable.finished")
        .forEach((syllable) => syllable.classList.remove("finished")),
    );
    lines.forEach((line) =>
      line.querySelectorAll(".shared-word-wipe").forEach((fragment) => {
        const target = fragment;
        target.style.transition = "none";
        target.style.backgroundColor = "var(--lyplus-text-secondary)";
      }),
    );
    const started = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - started) / 260);
      const eased = progress * progress * (3 - 2 * progress);
      const playbackAdvance = this.currentTime - targetTime;
      for (const { animation, from, to } of this.rewindEffects)
        if (animation.playState !== "idle")
          animation.currentTime = from + (to + playbackAdvance - from) * eased;
      if (progress < 1) {
        this.rewindFrame = requestAnimationFrame(tick);
      } else {
        this.finishLineRewind();
        for (const line of lines) {
          LyricsRuntime.updateSyllablesForLine(
            line,
            this.currentTime,
            this.shouldReduceMotion,
          );
          LyricsRuntime.seekLineWipes(line, this.currentTime);
        }
      }
    };
    this.rewindFrame = requestAnimationFrame(tick);
  }
  set currentTime(value) {
    const oldValue = this._currentTime;
    if (oldValue - value > 32 && !this.shouldReduceMotion) {
      const nextActive = this.findActiveLineIndices(value);
      const sharedLines = this.activeLineIndices
        .filter((index) => nextActive.includes(index))
        .map((index) => this._getLineElement(index))
        .filter((line) => line !== null);
      if (sharedLines.length) this.startLineRewind(sharedLines, value);
      else this.finishLineRewind();
    } else if (this.rewindingLines.size) {
      const nextActive = this.findActiveLineIndices(value);
      if (
        value - oldValue > SEEK_THRESHOLD_MS ||
        [...this.rewindingLines].some(
          (line) =>
            !nextActive.includes(
              LyricsRuntime.getLineIndexFromElement(line) ?? -1,
            ),
        )
      )
        this.finishLineRewind();
    }
    this._currentTime = value;
    if (oldValue !== value && this.lyrics) {
      this._onTimeChanged(oldValue, value);
    }
  }
  get currentTime() {
    return this._currentTime;
  }
  ensureTimingCache() {
    if (this.timingLyrics === this.lyrics) return;
    this.timingLyrics = this.lyrics;
    this.lineHighlightEnds = [];
    this.activeTimelineInterval = undefined;
  }
  getBackgroundWrap(line) {
    let wrap = this.backgroundWraps.get(line);
    if (wrap === undefined) {
      wrap = line.querySelector(".background-vocal-wrap");
      this.backgroundWraps.set(line, wrap);
    }
    return wrap;
  }
  _updateFooter() {
    const footer = this.shadowRoot?.querySelector(".lyrics-footer");
    if (!footer) return;
    const switchBtn = footer.querySelector(".source-switch-btn");
    const svgEl = footer.querySelector(".source-switch-svg");
    const labelEl = footer.querySelector(".source-switch-label");
    if (switchBtn) {
      switchBtn.disabled = this.isFetchingAlternatives;
    }
    if (svgEl) {
      svgEl.classList.toggle("is-loading", this.isFetchingAlternatives);
    }
    if (labelEl) {
      labelEl.textContent = this.isFetchingAlternatives
        ? "Switching..."
        : "Switch";
    }
  }
  connectedCallback() {
    super.connectedCallback();
    this.motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    this.systemReducedMotion = this.motionPreference.matches;
    this.motionPreference.addEventListener(
      "change",
      this.handleMotionPreference,
    );
    this.fetchLyrics();
  }
  disconnectedCallback() {
    this.lyricsContainer?.removeEventListener("scroll", this._boundHandleViewportSync);
    this.finishLineRewind();
    this.pendingLayoutOffsets.clear();
    this.clearGapAnimations();
    super.disconnectedCallback();
    this.motionPreference?.removeEventListener(
      "change",
      this.handleMotionPreference,
    );
    this.motionPreference = undefined;
    this.cancelLineScrollAnimation();
    this.lyricsContainer
      ?.querySelectorAll(".native-motion")
      .forEach((char) => LyricsRuntime.clearCharacterMotion(char));
    this.lyricsContainer?.querySelectorAll(".lyrics-word").forEach((word) => {
      LyricsRuntime.clearWordWipe(word);
    });
    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
      this.userScrollTimeoutId = undefined;
    }
    if (this.clickSeekTimeout) {
      clearTimeout(this.clickSeekTimeout);
      this.clickSeekTimeout = undefined;
    }
    this.clearBackgroundExpandedLine();
    this.clearProgressiveBlurLine();
    this.fetchAbortController?.abort();
    this.fetchAbortController = undefined;
    if (this.lyricsContainer) {
      this.lyricsContainer.removeEventListener(
        "wheel",
        this._boundHandleUserScroll,
      );
      this.lyricsContainer.removeEventListener(
        "touchmove",
        this._boundHandleUserScroll,
      );
    }
    this.preActiveLineElements = [];
    this.positionedLineElements = [];
    this.clearGapAnimations();
    this.activeGapLineElements = [];
    this.lastInstrumentalIndex = null;
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = undefined;
  }
  async fetchLyrics() {
    this.fetchAbortController?.abort();
    const controller = new AbortController();
    this.fetchAbortController = controller;
    this.isLoading = true;
    this.lyrics = undefined;
    this.lyricsSource = null;
    this.availableSources = [];
    this.currentSourceIndex = 0;
    this.isFetchingAlternatives = false;
    this.hasFetchedAllProviders = false;
    this._updateFooter();
    try {
      if (this.ttml) {
        const parseResult = LyricsRuntime.parseTTML(this.ttml);
        if (parseResult && parseResult.lines.length > 0) {
          this.lyrics = parseResult.lines;
          this.lyricsSource = "Local";
          if (parseResult.songwriters) {
            this.songwriters = parseResult.songwriters;
          }
          this.availableSources = [
            {
              lines: this.lyrics,
              source: "Local",
              originalTTML: this.ttml,
              songwriters: this.songwriters,
            },
          ];
          this.currentSourceIndex = 0;
          this.hasFetchedAllProviders = true;
          this._updateFooter();
          await this.onLyricsLoaded();
          return;
        }
      }
      const lrcRedResult = await LyricsRuntime.fetchLyricsFromLrcRed(
        this.songTitle?.trim() || "",
        this.songArtist?.trim() || "",
        this.isrc?.trim(),
        {
          album: this.songAlbum?.trim(),
          durationMs: this.songDurationMs || this.duration,
        },
        this.query?.trim(),
      );
      if (controller.signal.aborted) return;
      if (lrcRedResult) {
        this.availableSources = [lrcRedResult];
        this.lyrics = lrcRedResult.lines;
        this.lyricsSource = lrcRedResult.source;
        if (lrcRedResult.songwriters) {
          this.songwriters = lrcRedResult.songwriters;
        }
        this._updateFooter();
        await this.onLyricsLoaded();
        return;
      }
      const resolvedMetadata = await this.resolveSongMetadata();
      if (controller.signal.aborted) return;
      const isMusicIdOnlyRequest =
        Boolean(this.musicId) &&
        !this.songTitle &&
        !this.songArtist &&
        !this.query &&
        !this.isrc;
      const collectedSources = [];
      if (resolvedMetadata?.metadata && !isMusicIdOnlyRequest) {
        const title = resolvedMetadata.metadata.title?.trim() || "";
        const artist = resolvedMetadata.metadata.artist?.trim() || "";
        const biniResult = await LyricsRuntime.fetchLyricsFromBiniLyrics(
          title,
          artist,
          resolvedMetadata.catalogIsrc,
          resolvedMetadata.metadata,
        );
        if (biniResult && biniResult.lines.length > 0) {
          collectedSources.push(biniResult);
        }
        const hasWordSync = (sources) =>
          sources.some((s) =>
            s.lines.some(
              (l) => l.isWordSynced || (l.text && l.text.length > 1),
            ),
          );
        if (collectedSources.length === 0 || !hasWordSync(collectedSources)) {
          const unisonResult = await LyricsRuntime.fetchLyricsFromUnison(
            resolvedMetadata.metadata,
          );
          if (unisonResult && unisonResult.lines.length > 0) {
            collectedSources.push(unisonResult);
          }
        }
        if (collectedSources.length === 0 || !hasWordSync(collectedSources)) {
          const youLyResults = await LyricsRuntime.fetchLyricsFromYouLyPlus(
            title,
            artist,
            resolvedMetadata.catalogIsrc,
            resolvedMetadata.metadata,
            true,
          );
          if (youLyResults && youLyResults.length > 0) {
            collectedSources.push(...youLyResults);
          }
        }
      }
      const hasLineSync = (sources) =>
        sources.some((s) =>
          s.lines.some((l) => l.timestamp > 0 || l.endtime > 0),
        );
      if (
        (collectedSources.length === 0 || !hasLineSync(collectedSources)) &&
        resolvedMetadata?.metadata
      ) {
        const lrclibResult = await LyricsRuntime.fetchLyricsFromLrclib(
          resolvedMetadata.metadata,
        );
        if (lrclibResult && lrclibResult.lines.length > 0) {
          collectedSources.push({
            lines: lrclibResult.lines,
            source: "LRCLIB",
          });
        }
      }
      if (collectedSources.length === 0 && resolvedMetadata?.metadata) {
        const geniusResult = await LyricsRuntime.fetchLyricsFromGenius(
          resolvedMetadata.metadata,
        );
        if (geniusResult && geniusResult.lines.length > 0) {
          collectedSources.push({
            lines: geniusResult.lines,
            source: "Genius",
          });
        }
      }
      this.hasFetchedAllProviders =
        collectedSources.length === 0 ||
        collectedSources.some(
          (s) => s.source === "LRCLIB" || s.source === "Genius",
        );
      this._updateFooter();
      if (collectedSources.length > 0) {
        this.availableSources =
          LyricsRuntime.mergeAndSortSources(collectedSources);
        this.currentSourceIndex = 0;
        const sourceResult = this.availableSources[0];
        this.lyrics = sourceResult.lines;
        this.lyricsSource = sourceResult.source;
        if (sourceResult.songwriters) {
          this.songwriters = sourceResult.songwriters;
        }
        await this.onLyricsLoaded();
        return;
      }
      this.lyrics = undefined;
      this.lyricsSource = null;
    } finally {
      if (!controller.signal.aborted) {
        this.isLoading = false;
      }
    }
  }
  async onLyricsLoaded() {
    this.activeLineIndices = [];
    this.preActiveLineElements = [];
    this.positionedLineElements = [];
    this.clearGapAnimations();
    this.activeGapLineElements = [];
    this.lastInstrumentalIndex = null;
    this.clearBackgroundExpandedLine();
    if (this.lyricsContainer) {
      this.isProgrammaticScroll = true;
      this.lyricsContainer.scrollTop = 0;
      window.setTimeout(() => {
        this.isProgrammaticScroll = false;
      }, 100);
    }
    if (!this.noAutoAlternates) await this.autoProcessLyrics();
  }
  async autoProcessLyrics() {
    if (this.noAutoAlternates) return;
    if (this.showRomanization) {
      await this.applyRomanization();
    }
    if (this.showTranslation && !this.noAutoAlternates) {
      await this.applyTranslation();
    }
  }
  static getRankForCollected(sourceLabel, parsedLines) {
    const lower = sourceLabel.toLowerCase();
    if (lower === "lrc.red") return 0;
    const hasWordSync = parsedLines.some(
      (line) => line.text && Array.isArray(line.text) && line.text.length > 1,
    );
    const isUnsynced =
      parsedLines.length > 0 &&
      parsedLines.every((line) => line.timestamp === 0 && line.endtime === 0);
    const isQQ = lower.includes("qq") || lower.includes("lyricsplus");
    if (lower.includes("apple") && hasWordSync) return 1;
    if (lower.includes("bini") && hasWordSync) return 2;
    if (lower.includes("unison") && hasWordSync) return 3;
    if (isQQ && hasWordSync) return 4;
    if (lower.includes("musixmatch") && hasWordSync) return 5;
    if (lower.includes("lrclib") && hasWordSync) return 6;
    if (hasWordSync) return 7;
    if (lower.includes("apple") && !hasWordSync && !isUnsynced) return 8;
    if (lower.includes("bini") && !hasWordSync && !isUnsynced) return 9;
    if (lower.includes("unison") && !hasWordSync && !isUnsynced) return 10;
    if (isQQ && !hasWordSync && !isUnsynced) return 11;
    if (lower.includes("musixmatch") && !hasWordSync && !isUnsynced) return 12;
    if (lower.includes("lrclib") && !hasWordSync && !isUnsynced) return 13;
    if (!hasWordSync && !isUnsynced) return 14;
    if (lower.includes("apple") && isUnsynced) return 15;
    if (lower.includes("bini") && isUnsynced) return 16;
    if (lower.includes("unison") && isUnsynced) return 17;
    if (isQQ && isUnsynced) return 18;
    if (lower.includes("musixmatch") && isUnsynced) return 19;
    if (lower.includes("lrclib") && isUnsynced) return 20;
    if (lower.includes("genius")) return 21;
    return 30;
  }
  static getDisplaySourceLabel(sourceLabel) {
    return sourceLabel.toLowerCase().includes("lyricsplus")
      ? "QQ"
      : sourceLabel;
  }
  static getSourceKey(sourceLabel) {
    const lower = (sourceLabel || "").trim().toLowerCase();
    if (!lower) return "";
    if (lower.includes("lyricsplus") || lower === "qq") return "qq";
    return lower.replace(/\s+/g, " ");
  }
  static mergeAndSortSources(collectedSources) {
    const uniqueSourcesMap = new Map();
    for (const source of collectedSources) {
      const normalizedSource = LyricsRuntime.getDisplaySourceLabel(
        source.source,
      );
      if (!uniqueSourcesMap.has(normalizedSource)) {
        uniqueSourcesMap.set(normalizedSource, {
          ...source,
          source: normalizedSource,
        });
      }
    }
    return Array.from(uniqueSourcesMap.values()).sort(
      (a, b) =>
        LyricsRuntime.getRankForCollected(a.source, a.lines) -
        LyricsRuntime.getRankForCollected(b.source, b.lines),
    );
  }
  findCurrentSourceIndex(
    sources = this.availableSources,
    sourceLabel = this.lyricsSource,
    lines = this.lyrics,
  ) {
    const identityIndex = sources.findIndex((source) => source.lines === lines);
    if (identityIndex !== -1) return identityIndex;
    const sourceKey = LyricsRuntime.getSourceKey(sourceLabel);
    if (!sourceKey) return -1;
    return sources.findIndex(
      (source) => LyricsRuntime.getSourceKey(source.source) === sourceKey,
    );
  }
  static getNextSourceIndex(
    sources,
    currentIndex,
    currentSourceLabel,
    currentLines,
  ) {
    if (sources.length <= 1) return -1;
    if (currentIndex !== -1) {
      return (currentIndex + 1) % sources.length;
    }
    const currentKey = LyricsRuntime.getSourceKey(currentSourceLabel);
    const fallbackIndex = sources.findIndex(
      (source) =>
        source.lines !== currentLines &&
        LyricsRuntime.getSourceKey(source.source) !== currentKey,
    );
    return fallbackIndex === -1 ? 0 : fallbackIndex;
  }
  async applySourceAtIndex(index) {
    const sourceResult = this.availableSources[index];
    if (!sourceResult) return;
    this.currentSourceIndex = index;
    this.lyrics = sourceResult.lines;
    this.lyricsSource = sourceResult.source;
    if (sourceResult.songwriters) {
      this.songwriters = sourceResult.songwriters;
    }
    await this.onLyricsLoaded();
  }
  async switchSource() {
    if (this.isFetchingAlternatives) return;
    const currentSourceLabel = this.lyricsSource;
    const currentLines = this.lyrics;
    if (!this.hasFetchedAllProviders) {
      this.isFetchingAlternatives = true;
      this._updateFooter();
      try {
        const resolvedMetadata = await this.resolveSongMetadata();
        if (resolvedMetadata?.metadata) {
          const newSources = [];
          if (!this.availableSources.some((s) => s.source === "BiniLyrics")) {
            const biniResult = await LyricsRuntime.fetchLyricsFromBiniLyrics(
              resolvedMetadata.metadata.title,
              resolvedMetadata.metadata.artist,
              resolvedMetadata.catalogIsrc,
              resolvedMetadata.metadata,
            );
            if (biniResult) newSources.push(biniResult);
          }
          if (
            !this.availableSources.some((s) =>
              s.source.toLowerCase().includes("unison"),
            )
          ) {
            const unisonResult = await LyricsRuntime.fetchLyricsFromUnison(
              resolvedMetadata.metadata,
            );
            if (unisonResult && unisonResult.lines.length > 0) {
              newSources.push(unisonResult);
            }
          }
          if (
            !this.availableSources.some(
              (s) =>
                s.source.toLowerCase().includes("apple") ||
                s.source.toLowerCase().includes("qq"),
            )
          ) {
            const title = resolvedMetadata.metadata.title?.trim() || "";
            const artist = resolvedMetadata.metadata.artist?.trim() || "";
            const youLyResults = await LyricsRuntime.fetchLyricsFromYouLyPlus(
              title,
              artist,
              resolvedMetadata.catalogIsrc,
              resolvedMetadata.metadata,
              true,
            );
            if (youLyResults && youLyResults.length > 0) {
              newSources.push(...youLyResults);
            }
          }
          if (
            !this.availableSources.some((s) =>
              s.source.toLowerCase().includes("lrclib"),
            )
          ) {
            const lrclibResult = await LyricsRuntime.fetchLyricsFromLrclib(
              resolvedMetadata.metadata,
            );
            if (lrclibResult && lrclibResult.lines.length > 0) {
              newSources.push({
                lines: lrclibResult.lines,
                source: "LRCLIB",
              });
            }
          }
          if (
            !this.availableSources.some((s) =>
              s.source.toLowerCase().includes("genius"),
            )
          ) {
            const geniusResult = await LyricsRuntime.fetchLyricsFromGenius(
              resolvedMetadata.metadata,
            );
            if (geniusResult && geniusResult.lines.length > 0) {
              newSources.push({
                lines: geniusResult.lines,
                source: "Genius",
              });
            }
          }
          if (newSources.length > 0) {
            this.availableSources = LyricsRuntime.mergeAndSortSources([
              ...this.availableSources,
              ...newSources,
            ]);
            this.currentSourceIndex = this.findCurrentSourceIndex(
              this.availableSources,
              currentSourceLabel,
              currentLines,
            );
          }
        }
      } finally {
        this.hasFetchedAllProviders = true;
        this.isFetchingAlternatives = false;
        this._updateFooter();
      }
    }
    if (this.availableSources.length > 1) {
      const currentIndex = this.findCurrentSourceIndex(
        this.availableSources,
        currentSourceLabel,
        currentLines,
      );
      const nextIndex = LyricsRuntime.getNextSourceIndex(
        this.availableSources,
        currentIndex,
        currentSourceLabel,
        currentLines,
      );
      if (nextIndex !== -1) {
        await this.applySourceAtIndex(nextIndex);
      }
    }
  }
  async resolveSongMetadata() {
    const metadata = {
      title: this.songTitle?.trim() ?? "",
      artist: this.songArtist?.trim() ?? "",
      album: this.songAlbum?.trim() || undefined,
      songwriters: this.songwriters?.trim() || undefined,
      durationMs: undefined,
    };
    if (typeof this.songDurationMs === "number" && this.songDurationMs > 0) {
      metadata.durationMs = this.songDurationMs;
    } else if (typeof this.duration === "number" && this.duration > 0) {
      metadata.durationMs = this.duration;
    }
    const appleSong = null;
    let appleId = this.musicId;
    let catalogIsrc = this.isrc;
    if (
      this.query &&
      (!metadata.title || !metadata.artist || !metadata.album)
    ) {
      const parsed = LyricsRuntime.parseQueryMetadata(this.query);
      if (parsed) {
        if (!metadata.title && parsed.title) {
          metadata.title = parsed.title;
        }
        if (!metadata.artist && parsed.artist) {
          metadata.artist = parsed.artist;
        }
        if (!metadata.album && parsed.album) {
          metadata.album = parsed.album;
        }
      }
    }
    let catalogResult = null;
    if (this.query && (!metadata.title || !metadata.artist)) {
      catalogResult = await LyricsRuntime.searchLyricsPlusCatalog(this.query);
      if (catalogResult) {
        if (!metadata.title && catalogResult.title) {
          metadata.title = catalogResult.title;
        }
        if (!metadata.artist && catalogResult.artist) {
          metadata.artist = catalogResult.artist;
        }
        if (!metadata.album && catalogResult.album) {
          metadata.album = catalogResult.album;
        }
        if (!metadata.songwriters && catalogResult.songwriters) {
          metadata.songwriters = catalogResult.songwriters;
        }
        if (
          metadata.durationMs == null &&
          typeof catalogResult.durationMs === "number" &&
          catalogResult.durationMs > 0
        ) {
          metadata.durationMs = catalogResult.durationMs;
        }
        if (!appleId && catalogResult.id?.appleMusic) {
          appleId = catalogResult.id.appleMusic;
        }
        if (!catalogIsrc && catalogResult.isrc) {
          catalogIsrc = catalogResult.isrc;
        }
      }
    }
    const trimmedTitle = metadata.title?.trim() ?? "";
    const trimmedArtist = metadata.artist?.trim() ?? "";
    const trimmedAlbum = metadata.album?.trim();
    const sanitizedDuration =
      typeof metadata.durationMs === "number" &&
      Number.isFinite(metadata.durationMs) &&
      metadata.durationMs > 0
        ? Math.round(metadata.durationMs)
        : undefined;
    const finalMetadata =
      trimmedTitle && trimmedArtist
        ? {
            title: trimmedTitle,
            artist: trimmedArtist,
            album: trimmedAlbum || undefined,
            durationMs: sanitizedDuration,
          }
        : undefined;
    return {
      metadata: finalMetadata,
      appleId,
      appleSong,
      catalogIsrc,
    };
  }
  static parseQueryMetadata(rawQuery) {
    const trimmed = rawQuery?.trim();
    if (!trimmed) return null;
    const result = {};
    const hyphenSplit = trimmed.split(/\s[-–—]\s/);
    if (hyphenSplit.length >= 2) {
      const [rawTitle, ...rest] = hyphenSplit;
      const rawArtist = rest.join(" - ");
      const titleCandidate = rawTitle.trim();
      const artistCandidate = rawArtist.trim();
      if (titleCandidate && artistCandidate) {
        result.title = titleCandidate;
        result.artist = artistCandidate;
        return result;
      }
    }
    const bySplit = trimmed.split(/\s+[bB]y\s+/);
    if (bySplit.length === 2) {
      const [maybeTitle, maybeArtist] = bySplit.map((part) => part.trim());
      if (maybeTitle && maybeArtist) {
        result.title = maybeTitle;
        result.artist = maybeArtist;
        return result;
      }
    }
    return null;
  }
  static async searchLyricsPlusCatalog(searchTerm) {
    const trimmedQuery = searchTerm?.trim();
    if (!trimmedQuery) return null;
    for (const base of KPOE_SERVERS) {
      const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
      const url = `${normalizedBase}/v1/songlist/search?q=${encodeURIComponent(trimmedQuery)}`;
      try {
        const response = await fetchWithTimeout(url);
        if (response.ok) {
          const payload = await response.json();
          let results = [];
          const typedPayload = payload;
          if (Array.isArray(typedPayload?.results)) {
            results = typedPayload.results;
          } else if (Array.isArray(payload)) {
            results = payload;
          }
          if (results.length > 0) {
            const primary = results.find(
              (item) => item?.id && item.id.appleMusic,
            );
            return primary ?? results[0];
          }
        }
      } catch (error) {}
    }
    return null;
  }
  static async fetchLyricsFromLrcRed(
    title,
    artist,
    isrc,
    metadata = {},
    searchQuery = "",
  ) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LRC_RED_TIMEOUT_MS);
    try {
      const fetchTTML = async (trackIsrc) => {
        try {
          const response = await fetch(
            `https://lrc.red/s/${encodeURIComponent(trackIsrc)}.ttml`,
            {
              signal: controller.signal,
            },
          );
          if (!response.ok) return null;
          const originalTTML = await response.text();
          const parsed = LyricsRuntime.parseTTML(originalTTML);
          if (!parsed?.lines.length) return null;
          return {
            lines: parsed.lines,
            source: "lrc.red",
            originalTTML,
            songwriters: parsed.songwriters,
          };
        } catch {
          return null;
        }
      };
      if (isrc) {
        const result = await fetchTTML(isrc);
        if (result) return result;
        if (controller.signal.aborted) return null;
      }
      let url;
      if (title && artist) {
        const params = new URLSearchParams({
          track: title,
          artist,
        });
        if (metadata.album) params.set("album", metadata.album);
        if (
          metadata.durationMs &&
          Number.isFinite(metadata.durationMs) &&
          metadata.durationMs > 0
        ) {
          params.set(
            "duration",
            Math.round(metadata.durationMs / 1000).toString(),
          );
        }
        url = `https://lrc.red/match.json?${params.toString()}`;
      } else if (searchQuery) {
        url = `https://lrc.red/search.json?${new URLSearchParams({
          q: searchQuery,
        })}`;
      } else {
        return null;
      }
      try {
        const response = await fetch(url, {
          signal: controller.signal,
        });
        if (!response.ok) return null;
        const payload = await response.json();
        const hit = Array.isArray(payload?.hits) ? payload.hits[0] : undefined;
        if (typeof hit?.isrc === "string" && hit.isrc.trim()) {
          return await fetchTTML(hit.isrc.trim());
        }
      } catch {}
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  static async fetchLyricsFromBiniLyrics(title, artist, isrc, metadata = {}) {
    if ((!title || !artist) && !isrc) return null;
    try {
      let cacheData = null;
      if (isrc) {
        try {
          const isrcUrl = `https://lyrics-api.binimum.org/?isrc=${encodeURIComponent(isrc)}`;
          const isrcRes = await fetchWithTimeout(isrcUrl);
          if (isrcRes.ok) {
            const data = await isrcRes.json();
            if (data.results && data.results.length > 0) {
              cacheData = data;
            }
          }
        } catch {}
      }
      if (!cacheData && title && artist) {
        const cacheParams = new URLSearchParams({
          track: title,
          artist,
        });
        if (metadata.album) {
          cacheParams.append("album", metadata.album);
        }
        if (metadata.durationMs && metadata.durationMs > 0) {
          cacheParams.append(
            "duration",
            Math.round(metadata.durationMs / 1000).toString(),
          );
        }
        const cacheUrl = `https://lyrics-api.binimum.org/?${cacheParams.toString()}`;
        const cacheRes = await fetchWithTimeout(cacheUrl);
        if (cacheRes.ok) {
          cacheData = await cacheRes.json();
        }
      }
      if (cacheData && cacheData.results && cacheData.results.length > 0) {
        const result = cacheData.results[0];
        if (result.lyricsUrl) {
          const ttmlRes = await fetchWithTimeout(result.lyricsUrl);
          if (ttmlRes.ok) {
            const ttmlText = await ttmlRes.text();
            const parseResult = LyricsRuntime.parseTTML(ttmlText);
            if (parseResult && parseResult.lines.length > 0) {
              return {
                lines: parseResult.lines,
                source: "BiniLyrics",
                originalTTML: ttmlText,
                songwriters: parseResult.songwriters,
              };
            }
          }
        }
      }
    } catch (e) {
      console.error("Cache API failed", e);
    }
    return null;
  }
  static async fetchLyricsFromYouLyPlus(
    title,
    artist,
    isrc,
    metadata = {},
    skipBiniCache = false,
  ) {
    if ((!title || !artist) && !isrc) return [];
    const params = new URLSearchParams();
    if (title) params.append("title", title);
    if (artist) params.append("artist", artist);
    if (isrc) params.append("isrc", isrc);
    if (metadata.album) {
      params.append("album", metadata.album);
    }
    if (metadata.durationMs && metadata.durationMs > 0) {
      params.append(
        "duration",
        Math.round(metadata.durationMs / 1000).toString(),
      );
    }
    if (!DEFAULT_KPOE_SOURCE_ORDER.includes("apple")) {
      params.append("source", DEFAULT_KPOE_SOURCE_ORDER);
    }
    const getRank = (sourceLabel, parsedLines) => {
      const lower = sourceLabel.toLowerCase();
      const hasWordSync = parsedLines.some(
        (line) => line.text && Array.isArray(line.text) && line.text.length > 1,
      );
      const isUnsynced =
        parsedLines.length > 0 &&
        parsedLines.every((line) => line.timestamp === 0 && line.endtime === 0);
      const isQQ = lower.includes("qq") || lower.includes("lyricsplus");
      if (lower.includes("apple") && hasWordSync) return 1;
      if (lower.includes("bini") && hasWordSync) return 2;
      if (lower.includes("unison") && hasWordSync) return 3;
      if (isQQ && hasWordSync) return 4;
      if (lower.includes("musixmatch") && hasWordSync) return 5;
      if (hasWordSync) return 6;
      if (lower.includes("apple") && !hasWordSync && !isUnsynced) return 7;
      if (lower.includes("bini") && !hasWordSync && !isUnsynced) return 8;
      if (lower.includes("unison") && !hasWordSync && !isUnsynced) return 9;
      if (isQQ && !hasWordSync && !isUnsynced) return 10;
      if (lower.includes("musixmatch") && !hasWordSync && !isUnsynced)
        return 11;
      if (!hasWordSync && !isUnsynced) return 12;
      if (lower.includes("apple") && isUnsynced) return 13;
      if (lower.includes("bini") && isUnsynced) return 14;
      if (lower.includes("unison") && isUnsynced) return 15;
      if (isQQ && isUnsynced) return 16;
      if (lower.includes("musixmatch") && isUnsynced) return 17;
      return 30;
    };
    const allResults = [];
    if (!skipBiniCache) {
      const biniResult = await LyricsRuntime.fetchLyricsFromBiniLyrics(
        title,
        artist,
        isrc,
        metadata,
      );
      if (biniResult) {
        allResults.push(biniResult);
        return allResults;
      }
    }
    const shuffledServers = [...KPOE_SERVERS]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    for (const base of shuffledServers) {
      const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
      const url = `${normalizedBase}/v2/lyrics/get?${params.toString()}`;
      let payload = null;
      try {
        const response = await fetchWithTimeout(url);
        if (response.ok) {
          payload = await response.json();
        }
      } catch {
        payload = null;
      }
      if (payload) {
        const lines = LyricsRuntime.convertKPoeLyrics(payload);
        if (lines && lines.length > 0) {
          const sourceLabel =
            payload?.metadata?.source ||
            payload?.metadata?.provider ||
            "LyricsPlus (KPoe)";
          const rank = getRank(sourceLabel, lines);
          const result = {
            lines,
            source: sourceLabel,
          };
          allResults.push(result);
          if (rank === 1) {
            break;
          }
        }
      }
    }
    const hasHighRankResult = allResults.some(
      (r) => getRank(r.source, r.lines) <= 2,
    );
    if (!hasHighRankResult) {
      try {
        const fallbackParams = new URLSearchParams(params);
        const url = `https://lyricsplus.binimum.org/v2/lyrics/get?${fallbackParams.toString()}`;
        const response = await fetchWithTimeout(url);
        if (response.ok) {
          const payload = await response.json();
          if (payload) {
            const lines = LyricsRuntime.convertKPoeLyrics(payload);
            const sourceLabel =
              payload?.metadata?.source ||
              payload?.metadata?.provider ||
              "LyricsPlus (KPoe)";
            const hasWordSync = lines?.some(
              (line) =>
                line.text && Array.isArray(line.text) && line.text.length > 1,
            );
            if (lines && lines.length > 0 && hasWordSync) {
              allResults.push({
                lines,
                source: sourceLabel,
              });
            }
          }
        }
      } catch (error) {}
    }
    return allResults;
  }
  static parseLrcSubtitles(lrc) {
    if (!lrc || typeof lrc !== "string") return [];
    const lines = [];
    const rawLines = lrc.split("\n");
    const parsed = [];
    for (const raw of rawLines) {
      const match = raw.match(/^\[(\d{1,3}):(\d{2})\.(\d{2,3})\]\s?(.*)$/);
      if (!match) {
        continue;
      }
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      let centiseconds = parseInt(match[3], 10);
      if (match[3].length === 3) {
        centiseconds = Math.round(centiseconds / 10);
      }
      const timestamp = (minutes * 60 + seconds) * 1000 + centiseconds * 10;
      const text = match[4] || "";
      parsed.push({
        timestamp,
        text,
      });
    }
    for (let i = 0; i < parsed.length; i += 1) {
      const { timestamp, text } = parsed[i];
      const endtime =
        i + 1 < parsed.length ? parsed[i + 1].timestamp : timestamp + 5000;
      if (!text.trim()) {
        continue;
      }
      const syllable = {
        text,
        part: false,
        timestamp,
        endtime,
        lineSynced: true,
      };
      lines.push({
        text: [syllable],
        background: false,
        backgroundText: [],
        oppositeTurn: false,
        timestamp,
        endtime,
        isWordSynced: false,
      });
    }
    return lines;
  }
  static async fetchLyricsFromLrclib(metadata) {
    const title = metadata.title?.trim();
    const artist = metadata.artist?.trim();
    if (!title || !artist) return null;
    try {
      const searchQuery = `${artist} ${title}`;
      const params = new URLSearchParams({
        q: searchQuery,
      });
      const response = await fetchWithTimeout(
        `https://lrclib.net/api/search?${params.toString()}`,
        {
          headers: {
            "User-Agent": `apple-music-web-components/${VERSION}`,
          },
        },
      );
      if (!response.ok) return null;
      const results = await response.json();
      if (!Array.isArray(results) || results.length === 0) return null;
      const withSynced = results.find(
        (r) => r.syncedLyrics && typeof r.syncedLyrics === "string",
      );
      const bestMatch = withSynced || results[0];
      if (bestMatch.syncedLyrics) {
        const lines = LyricsRuntime.parseLrcSubtitles(bestMatch.syncedLyrics);
        if (lines.length > 0) {
          return {
            lines,
            source: "LRCLIB",
          };
        }
      }
      if (bestMatch.plainLyrics && typeof bestMatch.plainLyrics === "string") {
        const plainLines = bestMatch.plainLyrics
          .split("\n")
          .filter((l) => l.trim());
        if (plainLines.length > 0) {
          const lines = plainLines.map((text) => ({
            text: [
              {
                text,
                part: false,
                timestamp: 0,
                endtime: 0,
              },
            ],
            background: false,
            backgroundText: [],
            oppositeTurn: false,
            timestamp: 0,
            endtime: 0,
            isWordSynced: false,
          }));
          return {
            lines,
            source: "LRCLIB (unsynced)",
          };
        }
      }
    } catch {}
    return null;
  }
  static async fetchLyricsFromGenius(metadata) {
    const title = metadata.title?.trim();
    const artist = metadata.artist?.trim();
    if (!title || !artist) return null;
    try {
      const params = new URLSearchParams({
        title,
        artist,
      });
      const response = await fetchWithTimeout(
        `${GENIUS_WORKER_URL}?${params.toString()}`,
      );
      if (!response.ok) return null;
      const data = await response.json();
      if (data.lyrics) {
        const plainLines = data.lyrics
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("["));
        if (plainLines.length > 0) {
          const lines = plainLines.map((text) => ({
            text: [
              {
                text,
                part: false,
                timestamp: 0,
                endtime: 0,
              },
            ],
            background: false,
            backgroundText: [],
            oppositeTurn: false,
            timestamp: 0,
            endtime: 0,
            isWordSynced: false,
          }));
          return {
            lines,
            source: "Genius",
          };
        }
      }
    } catch {}
    return null;
  }
  static async fetchLyricsFromUnison(metadata) {
    const title = metadata.title?.trim();
    const artist = metadata.artist?.trim();
    if (!title || !artist) return null;
    const params = new URLSearchParams();
    params.append("song", title);
    params.append("artist", artist);
    if (metadata.album) {
      params.append("album", metadata.album);
    }
    if (metadata.durationMs && metadata.durationMs > 0) {
      params.append(
        "duration",
        Math.round(metadata.durationMs / 1000).toString(),
      );
    }
    try {
      const response = await fetchWithTimeout(
        `https://unison.boidu.dev/lyrics?${params.toString()}`,
      );
      if (!response.ok) return null;
      const data = await response.json();
      if (!data.success || !data.data?.lyrics) return null;
      const lyricsData = data.data;
      const format = lyricsData.format || "lrc";
      const syncType = lyricsData.syncType || "linesync";
      const lyricsText = lyricsData.lyrics;
      if (format === "ttml") {
        const parseResult = LyricsRuntime.parseTTML(lyricsText);
        if (parseResult && parseResult.lines.length > 0) {
          return {
            lines: parseResult.lines,
            source: "Unison",
            songwriters: parseResult.songwriters,
          };
        }
      }
      if (format === "lrc") {
        if (syncType === "plain") {
          const plainLines = lyricsText
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l);
          if (plainLines.length > 0) {
            const lines = plainLines.map((text) => ({
              text: [
                {
                  text,
                  part: false,
                  timestamp: 0,
                  endtime: 0,
                },
              ],
              background: false,
              backgroundText: [],
              oppositeTurn: false,
              timestamp: 0,
              endtime: 0,
              isWordSynced: false,
            }));
            return {
              lines,
              source: "Unison (unsynced)",
            };
          }
        } else {
          const lines = LyricsRuntime.parseLrcSubtitles(lyricsText);
          if (lines.length > 0) {
            return {
              lines,
              source: "Unison",
            };
          }
        }
      }
    } catch {}
    return null;
  }
  static calculateLineAlignments(lineSingers, agentTypes) {
    const lineSideAssignments = new Array(lineSingers.length).fill(undefined);
    let currentSideIsLeft = true;
    let lastPersonSingerId = null;
    let rightCount = 0;
    let totalCount = 0;
    lineSingers.forEach((singerId, index) => {
      let sideClass;
      if (singerId) {
        let type = agentTypes[singerId];
        if (!type) {
          if (singerId === "v1000") {
            type = "group";
          } else if (singerId === "v2000") {
            type = "other";
          } else {
            type = "person";
          }
        }
        if (type === "group") {
          sideClass = "start";
        } else {
          if (lastPersonSingerId === null) {
            if (type === "other") {
              currentSideIsLeft = false;
            } else {
              currentSideIsLeft = true;
            }
          } else if (singerId !== lastPersonSingerId) {
            currentSideIsLeft = !currentSideIsLeft;
          }
          sideClass = currentSideIsLeft ? "start" : "end";
          lastPersonSingerId = singerId;
        }
      }
      if (sideClass) {
        totalCount += 1;
        if (sideClass === "end") rightCount += 1;
      }
      lineSideAssignments[index] = sideClass;
    });
    if (totalCount > 0 && Math.round((rightCount / totalCount) * 100) >= 85) {
      const flip = (s) => {
        if (s === "start") return "end";
        if (s === "end") return "start";
        return s;
      };
      for (let i = 0; i < lineSideAssignments.length; i += 1) {
        lineSideAssignments[i] = flip(lineSideAssignments[i]);
      }
    }
    return lineSideAssignments;
  }
  static parseTTMLTime(value, fallback = 0) {
    if (!value) return fallback;
    const normalized = value.trim().toLowerCase();
    const unitMatch = normalized.match(/^(-?\d+(?:\.\d+)?)(ms|h|m|s)$/);
    if (unitMatch) {
      const amount = Number(unitMatch[1]);
      const multipliers = {
        ms: 1,
        s: 1000,
        m: 60000,
        h: 3600000,
      };
      return Math.max(0, Math.round(amount * multipliers[unitMatch[2]]));
    }
    const parts = normalized.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return fallback;
    let seconds = 0;
    if (parts.length === 3) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      seconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
      [seconds] = parts;
    } else {
      return fallback;
    }
    return Math.max(0, Math.round(seconds * 1000));
  }
  static isRightToLeftLanguage(language) {
    if (!language) return false;
    const primaryLanguage = language.toLowerCase().split(/[-_]/)[0];
    return ["ar", "dv", "fa", "he", "ku", "ps", "ur", "yi"].includes(
      primaryLanguage,
    );
  }
  static parseTTML(ttmlString) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(ttmlString, "text/xml");
      const translations = {};
      const transliterations = {};
      const agentMap = {};
      const documentLanguage =
        doc.documentElement.getAttribute("xml:lang") ||
        doc.documentElement.getAttribute("lang");
      const agents = doc.getElementsByTagName("ttm:agent");
      for (let i = 0; i < agents.length; i += 1) {
        const agent = agents[i];
        const id = agent.getAttribute("xml:id");
        const type = agent.getAttribute("type");
        if (id && type) {
          agentMap[id] = type;
        }
      }
      let songwriters;
      const songwritersNodes = doc.getElementsByTagName("songwriter");
      if (songwritersNodes.length > 0) {
        const names = [];
        for (let i = 0; i < songwritersNodes.length; i += 1) {
          if (songwritersNodes[i].textContent) {
            names.push(songwritersNodes[i].textContent);
          }
        }
        if (names.length > 0) {
          songwriters = names.join(", ");
        }
      }
      const translationNodes = doc.getElementsByTagName("translation");
      for (let i = 0; i < translationNodes.length; i += 1) {
        const texts = translationNodes[i].getElementsByTagName("text");
        for (let j = 0; j < texts.length; j += 1) {
          const textNode = texts[j];
          const key = textNode.getAttribute("for");
          if (key && textNode.textContent) {
            translations[key] = textNode.textContent;
          }
        }
      }
      const timeToMs = LyricsRuntime.parseTTMLTime;
      const transliterationNodes = doc.getElementsByTagName("transliteration");
      for (let i = 0; i < transliterationNodes.length; i += 1) {
        const texts = transliterationNodes[i].getElementsByTagName("text");
        for (let j = 0; j < texts.length; j += 1) {
          const textNode = texts[j];
          const key = textNode.getAttribute("for");
          if (!key) {
            continue;
          }
          const spans = Array.from(
            textNode.getElementsByTagName("span"),
          ).filter((span) => span.getAttribute("begin"));
          if (spans.length > 0) {
            const syllabus = [];
            let fullText = "";
            for (let k = 0; k < spans.length; k += 1) {
              const span = spans[k];
              const begin = span.getAttribute("begin");
              const end = span.getAttribute("end");
              let spanText = span.textContent || "";
              const nextNode = span.nextSibling;
              if (
                nextNode &&
                nextNode.nodeType === 3 &&
                /^\s/.test(nextNode.textContent || "") &&
                !spanText.endsWith(" ")
              ) {
                spanText += " ";
              }
              if (spanText.trim() === "") {
                continue;
              }
              syllabus.push({
                time: timeToMs(begin),
                duration: timeToMs(end) - timeToMs(begin),
                text: spanText,
              });
              fullText += spanText;
            }
            transliterations[key] = {
              text: fullText.trim(),
              syllabus,
            };
          } else if (textNode.textContent) {
            transliterations[key] = {
              text: textNode.textContent.trim().replace(/\s+/g, " "),
            };
          }
        }
      }
      const lines = [];
      const pNodes = doc.getElementsByTagName("p");
      for (let i = 0; i < pNodes.length; i += 1) {
        const p = pNodes[i];
        const key =
          p.getAttributeNS("http://lrc.red/lyric-ttml-internal", "key") ||
          p.getAttribute("itunes:key");
        const beginMs = timeToMs(p.getAttribute("begin"));
        const endMs = timeToMs(p.getAttribute("end"), beginMs);
        const agentId = p.getAttribute("ttm:agent") || undefined;
        const lineLanguage =
          p.getAttribute("xml:lang") ||
          p.getAttribute("lang") ||
          documentLanguage;
        let songPart;
        if (p.parentNode && p.parentNode.tagName === "div") {
          songPart =
            p.parentNode.getAttributeNS(
              "http://lrc.red/lyric-ttml-internal",
              "songPart",
            ) ||
            p.parentNode.getAttribute("itunes:songPart") ||
            undefined;
        }
        const mainSyllables = [];
        const bgSyllables = [];
        const spans = p.getElementsByTagName("span");
        const hasWordLevelSync = Array.from(spans).some((span) => {
          const isBackground =
            span.getAttribute("ttm:role") === "x-bg" ||
            span.parentNode?.getAttribute?.("ttm:role") === "x-bg";
          return (
            !isBackground &&
            Boolean(span.getAttribute("begin")) &&
            Boolean(span.getAttribute("end"))
          );
        });
        if (spans.length > 0) {
          for (let j = 0; j < spans.length; j += 1) {
            const span = spans[j];
            if (span.getAttribute("ttm:role") === "x-bg") {
              const bgInnerSpans = span.getElementsByTagName("span");
              for (let k = 0; k < bgInnerSpans.length; k += 1) {
                const bgSpan = bgInnerSpans[k];
                let bgText = bgSpan.textContent || "";
                const nextNode = bgSpan.nextSibling;
                if (
                  nextNode &&
                  nextNode.nodeType === 3 &&
                  /^\s/.test(nextNode.textContent || "") &&
                  !bgText.endsWith(" ")
                ) {
                  bgText += " ";
                }
                const bgTimestamp = timeToMs(
                  bgSpan.getAttribute("begin"),
                  beginMs,
                );
                bgSyllables.push({
                  text: bgText,
                  timestamp: bgTimestamp,
                  endtime: Math.max(
                    bgTimestamp,
                    timeToMs(bgSpan.getAttribute("end"), endMs),
                  ),
                  part: !/\s$/.test(bgText),
                });
              }
              continue;
            }
            if (
              span.parentNode &&
              span.parentNode.getAttribute?.("ttm:role") === "x-bg"
            ) {
              continue;
            }
            let text = span.textContent || "";
            const nextNode = span.nextSibling;
            if (
              nextNode &&
              nextNode.nodeType === 3 &&
              /^\s/.test(nextNode.textContent || "") &&
              !text.endsWith(" ")
            ) {
              text += " ";
            }
            const syllableTimestamp = timeToMs(
              span.getAttribute("begin"),
              beginMs,
            );
            mainSyllables.push({
              text,
              timestamp: syllableTimestamp,
              endtime: Math.max(
                syllableTimestamp,
                timeToMs(span.getAttribute("end"), endMs),
              ),
              part: !/\s$/.test(text),
            });
          }
        }
        if (mainSyllables.length === 0) {
          const primaryLineText = Array.from(p.childNodes)
            .filter(
              (node) =>
                !(
                  node instanceof Element &&
                  node.getAttribute("ttm:role") === "x-bg"
                ),
            )
            .map((node) => node.textContent || "")
            .join("")
            .trim();
          mainSyllables.push({
            text: primaryLineText,
            timestamp: beginMs,
            endtime: endMs,
            part: false,
            lineSynced: true,
          });
        }
        const lineTransliterationItem = key ? transliterations[key] : undefined;
        if (
          lineTransliterationItem &&
          mainSyllables.length > 1 &&
          spans.length > 0
        ) {
          if (
            lineTransliterationItem.syllabus &&
            lineTransliterationItem.syllabus.length === mainSyllables.length
          ) {
            mainSyllables.forEach((syl, mapIdx) => {
              syl.romanizedText = lineTransliterationItem.syllabus[mapIdx].text;
            });
          } else {
            const lineTransliteration = lineTransliterationItem.text;
            const romanWords = lineTransliteration.split(/\s+/).filter(Boolean);
            const syllableGroups = [];
            for (let si = 0; si < mainSyllables.length; si += 1) {
              if (mainSyllables[si].part && syllableGroups.length > 0) {
                syllableGroups[syllableGroups.length - 1].push(si);
              } else {
                syllableGroups.push([si]);
              }
            }
            const isCJK =
              /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(
                mainSyllables.map((s) => s.text).join(""),
              );
            if (romanWords.length === syllableGroups.length) {
              syllableGroups.forEach((group, gi) => {
                mainSyllables[group[0]].romanizedText = romanWords[gi];
              });
            } else if (romanWords.length === mainSyllables.length) {
              mainSyllables.forEach((syl, mapIdx) => {
                syl.romanizedText = romanWords[mapIdx];
              });
            } else if (isCJK) {
              let romanIdx = 0;
              for (const group of syllableGroups) {
                const syl = mainSyllables[group[0]];
                const sylText = group
                  .map((gIndex) => mainSyllables[gIndex].text)
                  .join("");
                const validChars =
                  sylText.match(
                    /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7afA-Za-z0-9]/g,
                  ) || [];
                const needed = validChars.length;
                if (needed > 0 && romanIdx < romanWords.length) {
                  syl.romanizedText = romanWords
                    .slice(romanIdx, romanIdx + needed)
                    .join(" ");
                  romanIdx += needed;
                }
              }
            }
          }
        }
        const resolvedBeginMs = p.getAttribute("begin")
          ? beginMs
          : Math.min(...mainSyllables.map((syllable) => syllable.timestamp));
        const resolvedEndMs = Math.max(
          endMs,
          resolvedBeginMs,
          ...mainSyllables.map((syllable) => syllable.endtime),
          ...bgSyllables.map((syllable) => syllable.endtime),
        );
        lines.push({
          text: mainSyllables,
          background: bgSyllables.length > 0,
          backgroundText: bgSyllables,
          timestamp: resolvedBeginMs,
          endtime: resolvedEndMs,
          isWordSynced: hasWordLevelSync,
          songPart,
          translation: key ? translations[key] : undefined,
          romanizedText: lineTransliterationItem?.text,
          oppositeTurn: false,
          agentId,
          direction:
            p.getAttribute("dir") === "rtl" ||
            LyricsRuntime.isRightToLeftLanguage(lineLanguage)
              ? "rtl"
              : undefined,
        });
      }
      const sortedLines = lines
        .map((line, sourceIndex) => ({
          line,
          sourceIndex,
        }))
        .sort(
          (a, b) =>
            a.line.timestamp - b.line.timestamp ||
            a.sourceIndex - b.sourceIndex,
        )
        .map((item) => item.line);
      const alignments = LyricsRuntime.calculateLineAlignments(
        sortedLines.map((line) => line.agentId),
        agentMap,
      );
      const alignedLines = sortedLines.map((line, index) => ({
        ...line,
        alignment: alignments[index],
        oppositeTurn: alignments[index] === "end",
      }));
      return {
        lines: alignedLines,
        songwriters,
      };
    } catch (e) {
      console.error("Failed to parse TTML", e);
      return null;
    }
  }
  static convertKPoeLyrics(payload) {
    if (!payload) {
      return null;
    }
    let rawLyrics = null;
    if (Array.isArray(payload?.lyrics)) {
      rawLyrics = payload.lyrics;
    } else if (Array.isArray(payload?.data?.lyrics)) {
      rawLyrics = payload.data.lyrics;
    } else if (Array.isArray(payload?.data)) {
      rawLyrics = payload.data;
    }
    if (!rawLyrics || rawLyrics.length === 0) {
      return null;
    }
    const sanitizedEntries = rawLyrics.filter((item) => Boolean(item));
    const lines = [];
    const isLineType = payload.type === "Line" || payload.type === "line";
    const agentTypes = {};
    if (payload.metadata?.agents) {
      Object.entries(payload.metadata.agents).forEach(([key, agent]) => {
        const mappedKey = agent.alias || key;
        agentTypes[mappedKey] = agent.type;
      });
    }
    const lineSingers = sanitizedEntries.map((entry) => entry.element?.singer);
    const alignments = LyricsRuntime.calculateLineAlignments(
      lineSingers,
      agentTypes,
    );
    for (let i = 0; i < sanitizedEntries.length; i += 1) {
      const entry = sanitizedEntries[i];
      const alignment = alignments[i];
      const lineText = typeof entry.text === "string" ? entry.text : "";
      const lineStart = LyricsRuntime.toMilliseconds(entry.time);
      const lineDuration = LyricsRuntime.toMilliseconds(entry.duration);
      const explicitEnd = LyricsRuntime.toMilliseconds(entry.endTime);
      const lineEnd = explicitEnd || lineStart + (lineDuration || 0);
      let syllabus = [];
      if (Array.isArray(entry.syllabus)) {
        syllabus = entry.syllabus.filter((s) => Boolean(s));
      } else if (Array.isArray(entry.words)) {
        syllabus = entry.words.filter((s) => Boolean(s));
      }
      const mainSyllables = [];
      const backgroundSyllables = [];
      if (!isLineType && syllabus.length > 0) {
        for (const syl of syllabus) {
          const sylStart = LyricsRuntime.toMilliseconds(syl.time, lineStart);
          const sylDuration = LyricsRuntime.toMilliseconds(syl.duration);
          const sylEnd =
            sylDuration === 0 && syllabus.length === 1
              ? lineEnd
              : sylStart + sylDuration;
          const syllable = {
            text: typeof syl.text === "string" ? syl.text : "",
            part: Boolean(syl.part),
            timestamp: sylStart,
            endtime: sylEnd,
          };
          if (syl.isBackground) {
            backgroundSyllables.push(syllable);
          } else {
            mainSyllables.push(syllable);
          }
        }
      }
      if (mainSyllables.length === 0 && lineText) {
        mainSyllables.push({
          text: lineText,
          part: false,
          timestamp: lineStart,
          endtime: lineEnd || lineStart,
          lineSynced: isLineType,
        });
      }
      const hasWordSync =
        !isLineType &&
        syllabus.length > 0 &&
        (mainSyllables.length > 0 || backgroundSyllables.length > 0);
      const { transliteration } = entry;
      let romanizedTextFromPayload;
      if (transliteration) {
        romanizedTextFromPayload = transliteration.text;
        if (
          Array.isArray(transliteration.syllabus) &&
          transliteration.syllabus.length === mainSyllables.length
        ) {
          transliteration.syllabus.forEach((s, idx) => {
            mainSyllables[idx].romanizedText = s.text;
          });
        }
      }
      const translationText = entry.translation?.text;
      const lineResult = {
        text: mainSyllables,
        background: backgroundSyllables.length > 0,
        backgroundText: backgroundSyllables,
        oppositeTurn:
          alignment === "end" ||
          (Array.isArray(entry.element)
            ? entry.element.includes("opposite") ||
              entry.element.includes("right")
            : false),
        timestamp: lineStart,
        endtime: lineEnd,
        isWordSynced: isLineType ? false : hasWordSync,
        alignment,
        songPart: entry.element?.songPart,
        romanizedText: romanizedTextFromPayload,
        translation: translationText,
      };
      lines.push(lineResult);
    }
    return lines;
  }
  static toMilliseconds(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num) || Number.isNaN(num)) {
      return fallback;
    }
    if (!Number.isInteger(num)) {
      return Math.round(num * 1000);
    }
    return Math.max(0, Math.round(num));
  }
  firstUpdated() {
    if (this.lyricsContainer) {
      this.lyricsContainer.addEventListener("scroll", this._boundHandleViewportSync, { passive: true });
      this.lyricsContainer.addEventListener(
        "wheel",
        this._boundHandleUserScroll,
        {
          passive: true,
        },
      );
      this.lyricsContainer.addEventListener(
        "touchmove",
        this._boundHandleUserScroll,
        {
          passive: true,
        },
      );
    }
  }
  _onTimeChanged(oldTime, newTime) {
    if (this.hidePlayedLines) this.updatePlayedLines(newTime);
    const timeDiff = Math.abs(newTime - oldTime);
    const isSeek = timeDiff > SEEK_THRESHOLD_MS;
    const newActiveLines = this.findActiveLineIndices(newTime);
    const oldActiveLines = this.activeLineIndices;
    const linesChanged = !LyricsRuntime.arraysEqual(
      newActiveLines,
      oldActiveLines,
    );
    if (newTime < oldTime && (linesChanged || isSeek)) {
      for (const line of this.cachedLineArray) {
        for (const word of LyricsRuntime.motionWords.get(line) || []) {
          if (newTime < word.start) {
            word.element.classList.remove("word-started");
          }
        }
      }
    }
    if (linesChanged || isSeek) {
      if (this.lyricsContainer) {
        for (const lineIndex of oldActiveLines) {
          if (!newActiveLines.includes(lineIndex)) {
            const lineElement = this._getLineElement(lineIndex);
            if (lineElement) {
              LyricsRuntime.unfinishSyllables(lineElement);
              lineElement.classList.remove("active", "scroll-exiting");
              lineElement.classList.remove("progressive-unblur");
              lineElement.removeAttribute("aria-current");
              if (lineElement.classList.contains("pre-active")) {
                lineElement.classList.remove("pre-active");
              }
              lineElement.style.removeProperty("filter");
              const preIdx = this.preActiveLineElements.indexOf(lineElement);
              if (preIdx !== -1) this.preActiveLineElements.splice(preIdx, 1);
            }
          }
        }
        for (const lineIndex of newActiveLines) {
          if (!oldActiveLines.includes(lineIndex) || isSeek) {
            const lineElement = this._getLineElement(lineIndex);
            if (lineElement) {
              if (!oldActiveLines.includes(lineIndex)) {
                lineElement
                  .querySelectorAll(".native-motion")
                  .forEach((char) => LyricsRuntime.clearCharacterMotion(char));
              }
              lineElement.classList.add("active");
              lineElement.setAttribute("aria-current", "true");
              lineElement.classList.remove("pre-active", "scroll-exiting");
              lineElement.classList.remove("progressive-unblur");
              lineElement.style.removeProperty("filter");
              const preIdx = this.preActiveLineElements.indexOf(lineElement);
              if (preIdx !== -1) this.preActiveLineElements.splice(preIdx, 1);
            }
          }
        }
        for (const lineElement of this.preActiveLineElements) {
          const idx = LyricsRuntime.getLineIndexFromElement(lineElement);
          if (
            idx === null ||
            (!newActiveLines.includes(idx) &&
              lineElement !== this.currentPrimaryActiveLine)
          ) {
            lineElement.classList.remove("pre-active");
            lineElement.classList.remove("progressive-unblur");
            lineElement.style.removeProperty("filter");
          }
        }
        this.preActiveLineElements = this.preActiveLineElements.filter((el) =>
          el.classList.contains("pre-active"),
        );
      }
      this.activeLineIndices = newActiveLines;
    }
    this.setBackgroundExpandedLine(null);
    if (linesChanged && this.isUserScrolling) this.scheduleViewportSync();
    this._handleActiveLineScroll(isSeek);
    if (linesChanged || isSeek) {
      this.clearPastLineHighlights();
    }
    if (this.lyricsContainer) {
      for (const lineIndex of this.activeLineIndices) {
        const lineElement = this._getLineElement(lineIndex);
        if (
          lineElement?.classList.contains("active") &&
          !this.rewindingLines.has(lineElement)
        ) {
          LyricsRuntime.updateSyllablesForLine(
            lineElement,
            newTime,
            this.shouldReduceMotion,
          );
          if (isSeek) LyricsRuntime.seekLineWipes(lineElement, newTime);
        }
      }
      const currentGap = this.findInstrumentalGapAt(newTime);
      const gapElements = new Set(this.activeGapLineElements);
      if (currentGap) {
        const currentGapElement = this._getGapElement(
          currentGap.insertBeforeIndex,
        );
        if (currentGapElement) gapElements.add(currentGapElement);
      }
      for (const gap of gapElements) {
        this.updateInstrumentalGap(gap, newTime);
      }
      if (currentGap) {
        if (currentGap.insertBeforeIndex !== this.lastInstrumentalIndex) {
          this.setBackgroundExpandedLine(null);
          if (
            this.autoScroll &&
            !this.isUserScrolling &&
            !this.isClickSeeking
          ) {
            this.scrollToInstrumental(currentGap.insertBeforeIndex);
          }
        }
        this.lastInstrumentalIndex = currentGap.insertBeforeIndex;
        if (currentGap.insertBeforeIndex > 0) {
          const prevLine = this._getLineElement(
            currentGap.insertBeforeIndex - 1,
          );
          if (
            prevLine &&
            prevLine.classList.contains("persist-highlight") &&
            !prevLine.classList.contains("active")
          ) {
            LyricsRuntime.unfinishSyllables(prevLine);
          }
        }
      } else if (this.lastInstrumentalIndex !== null) {
        this.lastInstrumentalIndex = null;
      }
      const lastLyric =
        this.lyrics && this.lyrics.length > 0
          ? this.lyrics[this.lyrics.length - 1]
          : null;
      const footer = this.footerElement;
      if (footer && lastLyric && lastLyric.endtime > 0) {
        const isFooterActive = newTime > lastLyric.endtime + 200;
        if (isFooterActive && !footer.classList.contains("active")) {
          footer.classList.add("active");
          const lastLine = this.lyrics
            ? this._getLineElement(this.lyrics.length - 1)
            : null;
          if (lastLine) {
            lastLine.classList.remove("pre-active");
            lastLine.classList.remove("progressive-unblur");
            lastLine.style.removeProperty("filter");
            const preIdx = this.preActiveLineElements.indexOf(lastLine);
            if (preIdx !== -1) this.preActiveLineElements.splice(preIdx, 1);
          }
        } else if (!isFooterActive && footer.classList.contains("active")) {
          footer.classList.remove("active");
        }
      }
    }
  }
  updatePlayedLines(time) {
    if (!this.lyrics) return;
    this.lyrics.forEach((line, index) => {
      const played =
        this.hidePlayedLines &&
        this.getLineHighlightEndTime(index) > line.timestamp &&
        time >= this.getLineHighlightEndTime(index);
      this._getLineElement(index)?.classList.toggle("played", played);
    });
  }
  willUpdate(changedProperties) {
    if (changedProperties.has("lyrics")) {
      this.cachedLineData = null;
      this._ensureLineDataCache();
    }
    if (
      this.lyrics &&
      !changedProperties.has("lyrics") &&
      (changedProperties.has("showRomanization") ||
        changedProperties.has("showTranslation") ||
        changedProperties.has("fontFamily"))
    )
      this.pendingRenderLayout = this.captureLyricLayout();
  }
  updated(changedProperties) {
    const lyricsDomBecameRenderable =
      changedProperties.has("lyrics") ||
      (changedProperties.has("isLoading") &&
        !this.isLoading &&
        Boolean(this.lyrics));
    if (lyricsDomBecameRenderable) {
      this._invalidateCaches();
      this._ensureLineDataCache();
      this._updateCachedIsUnsynced();
      this._updateCharTimingData();
      if (this.lyricsContainer && this.lyrics) {
        const activeLines = this.findActiveLineIndices(this.currentTime);
        for (const lineIndex of activeLines) {
          const lineEl = this._getLineElement(lineIndex);
          if (lineEl) {
            lineEl.classList.add("active");
            lineEl.setAttribute("aria-current", "true");
          }
        }
        const primaryActiveLine = this.getPrimaryActiveLineIndex(activeLines);
        this.setBackgroundExpandedLine(
          primaryActiveLine !== null
            ? this._getLineElement(primaryActiveLine)
            : null,
          true,
          activeLines,
        );
        this._onTimeChanged(0, this.currentTime);
        if (this.positionedLineElements.length === 0) {
          const firstLine = this.lyricsContainer.querySelector(".lyrics-line");
          if (firstLine) this.updatePositionClasses(firstLine);
        }
        this.visibilityObserver?.disconnect();
        this.visibilityObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              const el = entry.target;
              el.classList.toggle("far-line", !entry.isIntersecting);
            });
          },
          {
            root: this.lyricsContainer,
            rootMargin: "200px",
            threshold: 0,
          },
        );
        const lines = this.lyricsContainer.querySelectorAll(".lyrics-line");
        lines.forEach((line) => this.visibilityObserver.observe(line));
      }
    }
    if (lyricsDomBecameRenderable || changedProperties.has("hidePlayedLines")) {
      this.updatePlayedLines(this.currentTime);
    }
    if (this.pendingRenderLayout && !lyricsDomBecameRenderable) {
      this._updateCharTimingData();
      for (const line of this.backgroundExpandedLines) {
        const wrap = line.querySelector(".background-vocal-wrap");
        if (wrap)
          line.style.setProperty(
            "--am-lyrics-background-vocal-height",
            `${wrap.offsetHeight + 4}px`,
          );
      }
      this.finishLyricLayout(this.pendingRenderLayout);
      for (const index of this.activeLineIndices) {
        const line = this._getLineElement(index);
        if (line)
          LyricsRuntime.updateSyllablesForLine(
            line,
            this.currentTime,
            this.shouldReduceMotion,
          );
      }
    }
    this.pendingRenderLayout = undefined;
    if (changedProperties.has("noBlur") && this.noBlur) {
      this.clearProgressiveBlurLine();
    }
    if (
      changedProperties.has("reducedMotion") ||
      changedProperties.has("systemReducedMotion") ||
      changedProperties.has("lineMotion")
    ) {
      if (this.shouldReduceMotion) {
        this.finishLineRewind();
        for (const line of this.cachedLineArray) {
          line
            .querySelectorAll(".native-motion")
            .forEach((char) => LyricsRuntime.clearCharacterMotion(char));
        }
        for (const [line, animation] of this.backgroundAnimations) {
          animation.cancel();
          line.classList.remove("bg-collapsing");
        }
        this.backgroundAnimations.clear();
        for (const { animation } of this.contentSprings.values())
          animation.cancel();
        this.contentSprings.clear();
      }
      this.cancelLineScrollAnimation();
      if (this.lyricsContainer) {
        this.lyricsContainer.scrollTo({
          top: this.lyricsContainer.scrollTop,
          behavior: "instant",
        });
      }
      if (this.lyrics) this._onTimeChanged(this.currentTime, this.currentTime);
    }
    if (changedProperties.has("duration") && this.duration === -1) {
      this.currentTime = 0;
      this.activeLineIndices = [];
      this.preActiveLineElements = [];
      this.positionedLineElements = [];
      this.clearGapAnimations();
      this.activeGapLineElements = [];
      this.clearBackgroundExpandedLine();
      this.setUserScrolling(false);
      if (this.userScrollTimeoutId) {
        clearTimeout(this.userScrollTimeoutId);
        this.userScrollTimeoutId = undefined;
      }
      this.cancelLineScrollAnimation();
      if (this.lyricsContainer) this.lyricsContainer.scrollTop = 0;
      return;
    }
    if (
      (changedProperties.has("query") ||
        changedProperties.has("musicId") ||
        changedProperties.has("isrc") ||
        changedProperties.has("ttml") ||
        changedProperties.has("songTitle") ||
        changedProperties.has("songArtist") ||
        changedProperties.has("songAlbum") ||
        changedProperties.has("songDurationMs")) &&
      !changedProperties.has("currentTime")
    ) {
      this.fetchLyrics();
    }
    if (changedProperties.has("currentTime") && this.lyrics);
  }
  _handleActiveLineScroll(forceScroll = false) {
    if (!this.lyricsContainer || !this.lyrics || this.lyrics.length === 0) {
      return;
    }
    const footer = this.footerElement;
    if (footer?.classList.contains("active")) {
      this.setBackgroundExpandedLine(null);
      return;
    }
    let scrollLookAheadMs = 350;
    let low = 0;
    let high = this.lyrics.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.lyrics[middle].timestamp <= this.currentTime) low = middle + 1;
      else high = middle;
    }
    const currentAudioIndex = low - 1;
    if (
      currentAudioIndex !== -1 &&
      currentAudioIndex + 1 < this.lyrics.length
    ) {
      const currentLine = this.lyrics[currentAudioIndex];
      const nextLine = this.lyrics[currentAudioIndex + 1];
      const gap = nextLine.timestamp - currentLine.endtime;
      scrollLookAheadMs = Math.min(500, Math.max(350, gap));
    }
    const nextLineIndex = currentAudioIndex + 1;
    const nextLineElement =
      nextLineIndex >= 0 && nextLineIndex < this.lyrics.length
        ? this._getLineElement(nextLineIndex)
        : null;
    if (
      nextLineElement &&
      !this.noBlur &&
      !this.shouldReduceMotion &&
      !this.isUserScrolling &&
      this.lyricsContainer.classList.contains("blur-inactive-enabled") &&
      !this.lyricsContainer.classList.contains("not-focused") &&
      !nextLineElement.classList.contains("active") &&
      !nextLineElement.classList.contains("lyrics-gap")
    ) {
      if (this.progressiveBlurLine !== nextLineElement) {
        this.clearProgressiveBlurLine();
        this.progressiveBlurLine = nextLineElement;
        nextLineElement.classList.add("progressive-unblur");
        nextLineElement.style.filter = "blur(0em)";
        const animation = nextLineElement.animate(
          [
            {
              filter: `blur(${NEXT_LINE_BASE_BLUR_EM}em)`,
            },
            {
              filter: "blur(0em)",
            },
          ],
          {
            duration: NEXT_LINE_UNBLUR_DURATION_MS,
            easing: "linear",
            fill: "both",
          },
        );
        this.progressiveBlurAnimation = animation;
        animation.onfinish = () => {
          if (this.progressiveBlurAnimation === animation) animation.cancel();
        };
      }
      const elapsed =
        this.currentTime -
        this.lyrics[nextLineIndex].timestamp +
        NEXT_LINE_UNBLUR_DURATION_MS;
      const animation = this.progressiveBlurAnimation;
      if (elapsed < NEXT_LINE_UNBLUR_DURATION_MS) {
        if (animation.playState === "idle") animation.play();
        if (
          forceScroll ||
          animation.currentTime === null ||
          Math.abs(Number(animation.currentTime) - elapsed) > 200
        )
          animation.currentTime = elapsed;
      }
    } else {
      this.clearProgressiveBlurLine();
    }
    const predictiveTime = this.currentTime + scrollLookAheadMs;
    const predictiveActiveIndices = this.findActiveLineIndices(predictiveTime);
    let targetElement = null;
    let targetLineIndex = null;
    if (predictiveActiveIndices.length > 0) {
      targetLineIndex = this.getPrimaryScrollLineIndex(
        predictiveActiveIndices,
        predictiveTime,
      );
      if (targetLineIndex !== null && targetLineIndex !== -1) {
        targetElement = this._getLineElement(targetLineIndex);
      }
    }
    if (!targetElement) {
      targetLineIndex = this.getLineIndexAtTime(predictiveTime, 0);
      if (targetLineIndex !== null && targetLineIndex !== -1) {
        targetElement = this._getLineElement(targetLineIndex);
      }
    }
    if (!targetElement) {
      return;
    }
    const scrollDuration = scrollLookAheadMs;
    if (targetElement !== this.currentPrimaryActiveLine || forceScroll) {
      targetElement.style.setProperty(
        "--scroll-duration",
        `${scrollDuration}ms`,
      );
    }
    if (
      !targetElement.classList.contains("active") &&
      !targetElement.classList.contains("pre-active")
    ) {
      targetElement.classList.add("pre-active");
      if (!this.preActiveLineElements.includes(targetElement)) {
        this.preActiveLineElements.push(targetElement);
      }
    }
    const layoutChanged = this.setBackgroundExpandedLine(
      targetElement,
      true,
      predictiveActiveIndices,
      predictiveTime,
    );
    this.focusLine(targetElement, forceScroll || layoutChanged, scrollDuration);
    if (this.pendingLayoutOffsets.size)
      this.finishLyricLayout(this.captureLyricLayout());
  }
  _rebuildDomCache() {
    this.backgroundWraps = new WeakMap();
    if (!this.lyricsContainer) return;
    this.lineElementCache.clear();
    this.gapElementCache.clear();
    this.footerElement =
      this.lyricsContainer.querySelector(".lyrics-footer") ?? undefined;
    this.cachedLineArray = [];
    if (!this.lyrics) return;
    for (let i = 0; i < this.lyrics.length; i += 1) {
      const lineEl = this.lyricsContainer.querySelector(`#lyrics-line-${i}`);
      if (lineEl) {
        this.lineElementCache.set(i, lineEl);
        lineEl._cachedSyllableElements = null;
        LyricsRuntime.motionWords.delete(lineEl);
        LyricsRuntime.motionSyllables.delete(lineEl);
      }
      const gapEl = this.lyricsContainer.querySelector(`#gap-${i}`);
      if (gapEl) {
        gapEl._cachedStartTime = parseFloat(
          gapEl.getAttribute("data-start-time") || "0",
        );
        gapEl._cachedEndTime = parseFloat(
          gapEl.getAttribute("data-end-time") || "0",
        );
        this.gapElementCache.set(i, gapEl);
      }
    }
    this.lyricsContainer
      .querySelectorAll(".lyrics-word")
      .forEach((wordElement) => {
        LyricsRuntime.clearWordWipe(wordElement);
        LyricsRuntime.wordWipes.delete(wordElement);
        const target = wordElement;
        target._cachedVirtualWordElements = undefined;
        target._cachedVirtualWordCharSpans = undefined;
        target._wordPreWipeKey = undefined;
      });
    this.lyricsContainer
      .querySelectorAll(".lyrics-syllable")
      .forEach((syllable) => {
        LyricsRuntime.motionParameters.delete(syllable);
        LyricsRuntime.getCachedCharSpans(syllable).forEach((char) =>
          LyricsRuntime.clearCharacterMotion(char),
        );
        const target = syllable;
        target._cachedStartTime = undefined;
        target._cachedEndTime = undefined;
        target._cachedVocalTrack = undefined;
        target._cachedCharSpans = undefined;
      });
    const lineElements = this.lyricsContainer.querySelectorAll(".lyrics-line");
    this.cachedLineArray = Array.from(lineElements);
  }
  _getLineElement(index) {
    const cached = this.lineElementCache.get(index);
    if (cached) return cached;
    if (!this.lyricsContainer) return null;
    const el = this.lyricsContainer.querySelector(`#lyrics-line-${index}`);
    if (el) this.lineElementCache.set(index, el);
    return el;
  }
  _getGapElement(index) {
    const cached = this.gapElementCache.get(index);
    if (cached) return cached;
    if (!this.lyricsContainer) return null;
    const el = this.lyricsContainer.querySelector(`#gap-${index}`);
    if (el) this.gapElementCache.set(index, el);
    return el;
  }
  clearGapAnimations() {
    this.gapAnimations.forEach((motion, gap) => {
      motion.animations.forEach((animation) => animation.cancel());
      gap.classList.remove("active", "gap-collapsing", "gap-exiting");
    });
    this.gapAnimations.clear();
  }
  _invalidateCaches() {
    this.timingLyrics = undefined;
    this.lineHighlightEnds = [];
    this.activeTimelineInterval = undefined;
    this.finishLineRewind();
    this.pendingLayoutOffsets.clear();
    this.clearGapAnimations();
    this.cancelLineScrollAnimation();
    this.lyricsContainer
      ?.querySelectorAll(".native-motion")
      .forEach((char) => LyricsRuntime.clearCharacterMotion(char));
    this.clearProgressiveBlurLine();
    this.cachedAllGaps = [];
    this.cachedIsUnsynced = false;
    this.cachedLineData = null;
    this.lineElementCache.clear();
    this.gapElementCache.clear();
    this.footerElement = undefined;
    this.cachedLineArray = [];
    this.preActiveLineElements = [];
    this.positionedLineElements = [];
    this.clearGapAnimations();
    this.activeGapLineElements = [];
    this.lastInstrumentalIndex = null;
    this.clearBackgroundExpandedLine();
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = undefined;
  }
  _updateCachedIsUnsynced() {
    this.cachedIsUnsynced =
      this.lyrics && this.lyrics.length > 0
        ? this.lyrics.every((l) => l.timestamp === 0 && l.endtime === 0)
        : false;
  }
  static characterMotionMode(text, durationMs, background = false) {
    if (/[\u0590-\u08ff]/.test(text)) return "none";
    const count = splitLyricGraphemes(text.trim()).length;
    if (!count) return "none";
    if (/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/.test(text)) {
      return count > 1 ? "rise" : "none";
    }
    return !background && durationMs >= 1000 && count <= 7
      ? "emphasis"
      : "none";
  }
  _ensureLineDataCache() {
    if (this.cachedLineData || !this.lyrics) return;
    this.cachedLineData = this.lyrics.map((line) => {
      const wordGroups = [];
      let group = [];
      line.text.forEach((syllable, index) => {
        group.push(syllable);
        const next = line.text[index + 1];
        if (!next || /\s$/.test(syllable.text) || /^\s/.test(next.text)) {
          wordGroups.push(group);
          group = [];
        }
      });
      const lineSynced = LyricsRuntime.isLineSyncedLine(line);
      const words = wordGroups.map((syllables) => {
        const text = syllables
          .map((syllable) => syllable.text)
          .join("")
          .trim();
        const start = Math.min(
          ...syllables.map((syllable) => syllable.timestamp),
        );
        const end = Math.max(...syllables.map((syllable) => syllable.endtime));
        return {
          start,
          end,
          duration: end - start,
          mode: lineSynced
            ? "none"
            : LyricsRuntime.characterMotionMode(text, end - start),
          rtl: /[\u0590-\u08ff]/.test(text),
        };
      });
      return {
        wordGroups,
        groupGrowable: words.map((word) => word.mode === "emphasis"),
        groupGlowing: words.map((word) => word.mode === "emphasis"),
        groupCharRise: words.map((word) => word.mode === "rise"),
        groupCharDrag: words.map(() => false),
        vwFullDuration: words.map((word) => word.duration),
        vwCharOffset: words.map(() => 0),
        vwStartMs: words.map((word) => word.start),
        vwEndMs: words.map((word) => word.end),
        lineIsRTL: line.direction === "rtl" || words.some((word) => word.rtl),
      };
    });
  }
  _updateCharTimingData() {
    if (!this.shadowRoot) return;
    this._rebuildDomCache();
    const words = Array.from(this.shadowRoot.querySelectorAll(".lyrics-word"));
    const wordsById = new Map();
    words.forEach((word, index) => {
      const id = word.dataset.virtualWordId || `word-${index}`;
      const group = wordsById.get(id) || [];
      group.push(word);
      wordsById.set(id, group);
    });
    wordsById.forEach((group) => {
      const chars = group.flatMap((word) =>
        Array.from(word.querySelectorAll(".char")),
      );
      group.forEach((word) => {
        const target = word;
        target._cachedVirtualWordElements = group;
        target._cachedVirtualWordCharSpans = chars;
      });
      const syllable = group[0].querySelector(".lyrics-syllable");
      if (syllable) LyricsRuntime.getWordWipe(syllable);
    });
  }
  static arraysEqual(a, b) {
    return a.length === b.length && a.every((val, i) => val === b[i]);
  }
  static isLineSyncedLine(line) {
    if (!line) return false;
    return line.isWordSynced === false || line.text.some((s) => s.lineSynced);
  }
  getLineHighlightEndTime(index) {
    this.ensureTimingCache();
    if (this.lineHighlightEnds[index] !== undefined)
      return this.lineHighlightEnds[index];
    const end = this.computeLineHighlightEndTime(index);
    this.lineHighlightEnds[index] = end;
    return end;
  }
  computeLineHighlightEndTime(index) {
    if (!this.lyrics) return 0;
    const line = this.lyrics[index];
    if (!line) return 0;
    const backgroundEnd = line.backgroundText?.reduce(
      (latest, syllable) => Math.max(latest, syllable.endtime),
      line.timestamp,
    );
    const rawEnd = Math.max(
      line.endtime,
      backgroundEnd ?? line.timestamp,
      line.timestamp,
    );
    const nextLine = this.lyrics[index + 1];
    if (!nextLine || nextLine.timestamp <= line.timestamp) {
      return rawEnd > line.timestamp ? rawEnd + 200 : rawEnd;
    }
    if (rawEnd > nextLine.timestamp && nextLine.text.every((syllable) => !syllable.text.trim() || syllable.text.trim() === "♪")) {
      return nextLine.timestamp;
    }
    if (rawEnd > line.timestamp) {
      if (nextLine.timestamp < rawEnd) {
        return rawEnd;
      }
      const gapToNext = nextLine.timestamp - rawEnd;
      if (gapToNext >= INSTRUMENTAL_THRESHOLD_MS) {
        return rawEnd;
      }
    }
    return nextLine.timestamp;
  }
  static getLineIndexFromElement(lineElement) {
    if (!lineElement) return null;
    const match = lineElement.id.match(/^lyrics-line-(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }
  static easeOutExpo(progress) {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return 1 - 2 ** (-10 * progress);
  }
  static getCssTimeMs(element, propertyName, fallback) {
    const value = getComputedStyle(element)
      .getPropertyValue(propertyName)
      .trim();
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return fallback;
    return value.endsWith("ms") ? parsed : parsed * 1000;
  }
  updateInstrumentalGap(gap, timeMs) {
    const gapStartTime =
      gap._cachedStartTime ??
      parseFloat(gap.getAttribute("data-start-time") || "0");
    const gapEndTime =
      gap._cachedEndTime ??
      parseFloat(gap.getAttribute("data-end-time") || "0");
    if (gap.querySelector(".lyric-instrumental-note")) {
      const active = timeMs >= gapStartTime && timeMs < gapEndTime;
      if (gap.classList.contains("active") === active) return;
      const before = this.captureLyricLayout();
      gap.classList.toggle("active", active);
      gap.style.setProperty("--gap-scale", "1");
      gap.style.setProperty("--gap-opacity", "1");
      if (active && !this.activeGapLineElements.includes(gap)) this.activeGapLineElements.push(gap);
      if (!active) this.activeGapLineElements = this.activeGapLineElements.filter(element => element !== gap);
      this.finishLyricLayout(before);
      return;
    }
    let exitLeadMs = this.gapExitDurationCache.get(gap);
    if (exitLeadMs === undefined) {
      exitLeadMs = LyricsRuntime.getCssTimeMs(
        gap,
        "--am-lyrics-instrumental-exit-duration",
        GAP_EXIT_LEAD_MS,
      );
      this.gapExitDurationCache.set(gap, exitLeadMs);
    }
    let collapseLeadMs = this.gapCollapseDurationCache.get(gap);
    if (collapseLeadMs === undefined) {
      collapseLeadMs = LyricsRuntime.getCssTimeMs(
        gap,
        "--am-lyrics-instrumental-collapse-duration",
        GAP_COLLAPSE_LEAD_MS,
      );
      this.gapCollapseDurationCache.set(gap, collapseLeadMs);
    }
    let dots = this.gapDotCache.get(gap);
    if (!dots) {
      dots = Array.from(gap.querySelectorAll(".lyrics-syllable"));
      this.gapDotCache.set(gap, dots);
    }
    const duration = Math.max(1, gapEndTime - gapStartTime);
    const elapsed = timeMs - gapStartTime;
    if (elapsed < 0 || elapsed >= duration + GAP_EXIT_TRAIL_MS) {
      const before = gap.classList.contains("active")
        ? this.captureLyricLayout()
        : null;
      this.gapAnimations
        .get(gap)
        ?.animations.forEach((animation) => animation.cancel());
      this.gapAnimations.delete(gap);
      gap.classList.remove("active", "gap-collapsing", "gap-exiting");
      const index = this.activeGapLineElements.indexOf(gap);
      if (index !== -1) this.activeGapLineElements.splice(index, 1);
      if (before) this.finishLyricLayout(before);
      return;
    }
    const remaining = duration - elapsed;
    const layoutBefore =
      gap.classList.contains("active") !== remaining > collapseLeadMs
        ? this.captureLyricLayout()
        : null;
    gap.classList.toggle("active", remaining > collapseLeadMs);
    gap.classList.toggle("gap-collapsing", remaining <= collapseLeadMs);
    gap.classList.toggle(
      "gap-exiting",
      remaining <= collapseLeadMs + exitLeadMs,
    );
    if (!this.activeGapLineElements.includes(gap))
      this.activeGapLineElements.push(gap);
    if (layoutBefore) this.finishLyricLayout(layoutBefore);
    let motion = this.gapAnimations.get(gap);
    if (!motion) {
      const layer = gap.querySelector(".main-vocal-container");
      if (!layer) return;
      const exitStart = Math.max(
        GAP_ENTRY_SCALE_MS,
        duration - collapseLeadMs - exitLeadMs,
      );
      const end = Math.min(duration, exitStart + exitLeadMs);
      const entryStart = Math.max(
        0,
        Math.min(elapsed, exitStart - GAP_ENTRY_SCALE_MS),
      );
      const times = new Set([
        0,
        entryStart,
        entryStart + GAP_ENTRY_FADE_MS,
        entryStart + GAP_ENTRY_SCALE_MS,
        exitStart,
        end,
      ]);
      for (
        let t = entryStart + 25;
        t < entryStart + GAP_ENTRY_SCALE_MS;
        t += 25
      )
        times.add(t);
      for (
        let t = entryStart + GAP_ENTRY_SCALE_MS;
        t < exitStart;
        t += Math.max(200, exitStart / 1000)
      )
        times.add(t);
      for (let t = exitStart; t < end; t += 20) times.add(t);
      const frames = [...times]
        .filter((t) => t <= end)
        .sort((a, b) => a - b)
        .map((time) => {
          const cycle = GAP_PULSE_DURATION_MS * 2;
          const phase =
            (time + GAP_PULSE_DURATION_MS - (exitStart % cycle) + cycle) %
            cycle;
          const mix =
            (1 - Math.cos((Math.PI * phase) / GAP_PULSE_DURATION_MS)) / 2;
          let scale =
            (GAP_BREATH_MAX_SCALE +
              (GAP_BREATH_MIN_SCALE - GAP_BREATH_MAX_SCALE) * mix) *
            LyricsRuntime.easeOutExpo(
              LyricsRuntime.clamp(
                (time - entryStart) / GAP_ENTRY_SCALE_MS,
                0,
                1,
              ),
            );
          let opacity = LyricsRuntime.clamp(
            (time - entryStart) / GAP_ENTRY_FADE_MS,
            0,
            1,
          );
          if (time >= exitStart) {
            const progress = (time - exitStart) / Math.max(1, end - exitStart);
            const popping = progress <= GAP_EXIT_POP_PROGRESS;
            const phaseProgress = popping
              ? progress / GAP_EXIT_POP_PROGRESS
              : (progress - GAP_EXIT_POP_PROGRESS) /
                (1 - GAP_EXIT_POP_PROGRESS);
            const ease =
              phaseProgress * phaseProgress * (3 - 2 * phaseProgress);
            scale = popping
              ? GAP_BREATH_MIN_SCALE +
                (GAP_EXIT_POP_SCALE - GAP_BREATH_MIN_SCALE) * ease
              : GAP_EXIT_POP_SCALE * (1 - ease);
            opacity = popping ? 1 : 1 - ease;
          }
          return {
            offset: time / end,
            transform: `scale(${scale})`,
            opacity,
          };
        });
      const animation = layer.animate(frames, {
        duration: end,
        fill: "both",
      });
      const animations = [
        animation,
        ...dots.map((dot, index) =>
          dot.animate(
            [
              {
                opacity: 0.25,
              },
              {
                opacity: 1,
              },
            ],
            {
              duration: exitStart / 3,
              delay: (index * exitStart) / 3,
              fill: "both",
            },
          ),
        ),
      ];
      animations.forEach((effect) => {
        const timeline = effect;
        timeline.currentTime = elapsed;
      });
      motion = {
        animations,
        end,
      };
      this.gapAnimations.set(gap, motion);
    } else if (
      Math.abs(
        Number(motion.animations[0].currentTime) -
          Math.min(elapsed, motion.end),
      ) > 200
    ) {
      motion.animations.forEach((animation) => {
        const timeline = animation;
        timeline.currentTime = elapsed;
        if (
          animation.playState === "finished" &&
          elapsed < Number(animation.effect?.getComputedTiming().endTime)
        )
          animation.play();
      });
    }
  }
  clearProgressiveBlurLine() {
    this.progressiveBlurAnimation?.cancel();
    this.progressiveBlurAnimation = undefined;
    if (!this.progressiveBlurLine) return;
    this.progressiveBlurLine.classList.remove("progressive-unblur");
    this.progressiveBlurLine.style.removeProperty("filter");
    this.progressiveBlurLine = null;
  }
  captureLyricLayout() {
    const lines = this.cachedLineArray.length
      ? this.cachedLineArray
      : Array.from(
          this.lyricsContainer?.querySelectorAll(".lyrics-line") || [],
        );
    const reference = Math.max(0, lines.indexOf(this.currentPrimaryActiveLine));
    const nearby = lines.slice(Math.max(0, reference - 20), reference + 21);
    const contents = nearby.flatMap((line) =>
      Array.from(line.querySelectorAll(".main-vocal-container")),
    );
    return {
      tops: new Map(nearby.map((line) => [line, line.offsetTop])),
      contents: new Map(
        contents.map((content) => [content, content.offsetTop]),
      ),
      scrollTop: this.lyricsContainer?.scrollTop || 0,
    };
  }
  finishLyricLayout(before, deferScroll = false) {
    if (!this.lyricsContainer) return;
    const scrollCorrection = this.lyricsContainer.scrollTop - before.scrollTop;
    before.tops.forEach((top, line) => {
      const delta = top - line.offsetTop + scrollCorrection;
      if (Math.abs(delta) > 0.1)
        this.pendingLayoutOffsets.set(
          line,
          (this.pendingLayoutOffsets.get(line) || 0) + delta,
        );
    });
    const contentChanges = [...before.contents].map(([content, top]) => ({
      content,
      delta: top - content.offsetTop,
    }));
    for (const { content, delta } of contentChanges) {
      if (Math.abs(delta) < 0.1) continue;
      const previous = this.contentSprings.get(content);
      const pose = previous
        ? LyricsRuntime.sampleSpring(
            previous.position,
            previous.velocity,
            Number(previous.animation.currentTime || 0) / 1000,
            10,
          )
        : {
            position: 0,
            velocity: 0,
          };
      previous?.animation.cancel();
      this.contentSprings.delete(content);
      if (this.shouldReduceMotion || this.lineMotion === "instant") continue;
      const position = pose.position + delta;
      const animation = content.animate(
        LyricsRuntime.createLineSpringFrames(position, pose.velocity),
        {
          duration: 1200,
          easing: "linear",
          fill: "both",
        },
      );
      this.contentSprings.set(content, {
        animation,
        position,
        velocity: pose.velocity,
      });
      animation.onfinish = () => {
        if (this.contentSprings.get(content)?.animation !== animation) return;
        animation.cancel();
        this.contentSprings.delete(content);
      };
    }
    if (deferScroll || !this.pendingLayoutOffsets.size) return;
    const target = this.currentPrimaryActiveLine;
    const top =
      target && this.autoScroll && !this.isUserScrolling
        ? Math.max(0, target.offsetTop - this.getScrollPaddingTop(target))
        : this.lyricsContainer.scrollTop;
    this.animateScrollYouLy(-top, false, undefined, target);
  }
  setBackgroundExpandedLine(
    lineElement,
    deferScroll = false,
    visibleIndices = [],
    visibilityTime = this.currentTime,
  ) {
    const desired = new Set();
    for (const [index, lyric] of (this.lyrics ?? []).entries()) {
      if (!lyric.backgroundText.some(note =>
        this.currentTime >= note.timestamp - BACKGROUND_VISIBILITY_MARGIN_MS &&
        this.currentTime <= note.endtime + BACKGROUND_VISIBILITY_MARGIN_MS)) continue;
      const line = this._getLineElement(index);
      if (line && this.getBackgroundWrap(line)) desired.add(line);
    }
    const entering = [...desired].filter(
      (line) => !this.backgroundExpandedLines.has(line),
    );
    const leaving = [...this.backgroundExpandedLines].filter(
      (line) => !desired.has(line),
    );
    if (!entering.length && !leaving.length) return false;
    const before = this.captureLyricLayout();
    const changes = [...leaving, ...entering].map((line) => {
      const wrap = this.getBackgroundWrap(line);
      const style = getComputedStyle(wrap);
      const pose = {
        opacity: style.opacity,
        transform: style.transform,
        clipPath: style.clipPath,
      };
      const expanded = desired.has(line);
      const duration = this.shouldReduceMotion
        ? 0
        : LyricsRuntime.getCssTimeMs(
            line,
            expanded
              ? "--am-lyrics-background-vocal-enter-duration"
              : "--am-lyrics-background-vocal-exit-duration",
            BACKGROUND_TRANSITION_DURATION_MS,
          );
      const height = expanded ? wrap.offsetHeight + 4 : 0;
      return {
        line,
        wrap,
        pose,
        expanded,
        duration,
        height,
      };
    });
    for (const { line, wrap, pose, expanded, duration, height } of changes) {
      this.backgroundAnimations.get(line)?.cancel();
      this.backgroundAnimations.delete(line);
      if (expanded) {
        line.style.setProperty(
          "--am-lyrics-background-vocal-height",
          `${height}px`,
        );
        this.backgroundExpandedLines.add(line);
      } else {
        this.backgroundExpandedLines.delete(line);
      }
      line.classList.toggle("bg-expanded", expanded);
      line.classList.toggle("bg-collapsing", !expanded && duration > 0);
      const beforeMain = wrap.parentElement.classList.contains("background-before");
      if (duration > 0) {
        const animation = wrap.animate(
          [
            pose,
            {
              opacity: expanded ? .6 : 0,
              transform: expanded ? "translateY(0) scale(1)" : "translateY(-50%) scale(0)",
              clipPath: expanded ? "inset(0 0 0 0)" : beforeMain ? "inset(0 0 100% 0)" : "inset(100% 0 0 0)",
            },
          ],
          {
            duration,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
            fill: "both",
          },
        );
        this.backgroundAnimations.set(line, animation);
        animation.onfinish = () => {
          if (this.backgroundAnimations.get(line) !== animation) return;
          animation.cancel();
          this.backgroundAnimations.delete(line);
          line.classList.remove("bg-collapsing");
        };
      }
    }
    this.finishLyricLayout(before, deferScroll);
    return true;
  }
  clearBackgroundExpandedLine() {
    for (const animation of this.backgroundAnimations.values())
      animation.cancel();
    for (const line of new Set([
      ...this.backgroundExpandedLines,
      ...this.backgroundAnimations.keys(),
    ]))
      line.classList.remove("bg-expanded", "bg-collapsing");
    this.backgroundAnimations.clear();
    this.backgroundExpandedLines.clear();
    for (const { animation } of this.contentSprings.values())
      animation.cancel();
    this.contentSprings.clear();
  }
  getPrimaryActiveLineIndex(activeIndices) {
    if (activeIndices.length === 0) return null;
    const groupStart = activeIndices[0];
    const groupEnd = activeIndices[activeIndices.length - 1];
    let candidateIndex = Math.max(groupStart, groupEnd - 2);
    const currentPrimaryIndex = LyricsRuntime.getLineIndexFromElement(
      this.currentPrimaryActiveLine,
    );
    if (
      currentPrimaryIndex !== null &&
      activeIndices.includes(currentPrimaryIndex)
    ) {
      if (activeIndices.length <= 3) {
        candidateIndex = currentPrimaryIndex;
      } else if (candidateIndex < currentPrimaryIndex) {
        candidateIndex = currentPrimaryIndex;
      }
    }
    return candidateIndex;
  }
  getPrimaryScrollLineIndex(activeIndices, time) {
    if (!this.lyrics || this.lyrics.length === 0) return null;
    const primaryIndex = activeIndices.length
      ? activeIndices[activeIndices.length - 1]
      : this.getLineIndexAtTime(time, this.lastActiveIndex);
    if (primaryIndex === -1) return null;
    const currentPrimaryIndex = LyricsRuntime.getLineIndexFromElement(
      this.currentPrimaryActiveLine,
    );
    if (
      currentPrimaryIndex !== null &&
      primaryIndex > currentPrimaryIndex &&
      this.lyrics[currentPrimaryIndex] &&
      this.lyrics[primaryIndex] &&
      this.lyrics[currentPrimaryIndex].endtime ===
        this.lyrics[primaryIndex].endtime
    ) {
      const activeCount = this.findActiveLineIndices(time).length;
      if (activeCount <= 3) {
        return currentPrimaryIndex;
      }
    }
    return primaryIndex;
  }
  focusLine(
    lineElement,
    forceScroll = false,
    scrollDuration = undefined,
    skipScroll = false,
    preservePrimary = false,
  ) {
    const primaryChanged = lineElement !== this.currentPrimaryActiveLine;
    if (primaryChanged && !preservePrimary) {
      this.lastPrimaryActiveLine = this.currentPrimaryActiveLine;
      if (this.lastPrimaryActiveLine) {
        this.lastPrimaryActiveLine.style.setProperty(
          "--scroll-duration",
          `${scrollDuration ?? SCROLL_ANIMATION_DURATION_MS}ms`,
        );
        const previousIndex = LyricsRuntime.getLineIndexFromElement(
          this.lastPrimaryActiveLine,
        );
        const nextIndex = LyricsRuntime.getLineIndexFromElement(lineElement);
        const overlaps =
          previousIndex !== null &&
          nextIndex !== null &&
          this.getLineHighlightEndTime(previousIndex) >
            (this.lyrics?.[nextIndex].timestamp ?? 0);
        this.lastPrimaryActiveLine.classList.toggle(
          "scroll-exiting",
          !overlaps && !this.lastPrimaryActiveLine.classList.contains("active"),
        );
        if (!this.lastPrimaryActiveLine.classList.contains("active")) {
          this.lastPrimaryActiveLine.classList.remove("pre-active");
          this.preActiveLineElements = this.preActiveLineElements.filter(
            (element) => element !== this.lastPrimaryActiveLine,
          );
        }
      }
      this.currentPrimaryActiveLine = lineElement;
      this.currentPrimaryActiveLine.classList.remove("scroll-exiting");
      const lineIndex = LyricsRuntime.getLineIndexFromElement(lineElement);
      if (lineIndex !== null) {
        this.lastActiveIndex = lineIndex;
      }
    }
    const targetIndex = LyricsRuntime.getLineIndexFromElement(lineElement);
    if (!preservePrimary && targetIndex !== null) {
      for (const index of this.activeLineIndices) {
        if (
          index < targetIndex &&
          this.currentTime >= this.getLineHighlightEndTime(index) &&
          LyricsRuntime.isLineSyncedLine(this.lyrics?.[index]) &&
          this.getLineHighlightEndTime(index) <=
            (this.lyrics?.[targetIndex].timestamp ?? 0)
        ) {
          const previousLine = this._getLineElement(index);
          if (previousLine?.classList.contains("active")) {
            previousLine.classList.remove("active", "pre-active");
            previousLine.removeAttribute("aria-current");
            LyricsRuntime.unfinishSyllables(previousLine);
          }
        }
      }
    }
    if (primaryChanged || forceScroll) {
      this.updatePositionClasses(lineElement);
    }
    if (
      !skipScroll &&
      (forceScroll || primaryChanged || preservePrimary) &&
      this.autoScroll &&
      !this.isUserScrolling &&
      !this.isClickSeeking
    ) {
      this.scrollToActiveLineYouLy(lineElement, forceScroll, scrollDuration);
    }
  }
  setUserScrolling(value) {
    const changed = this.isUserScrolling !== value;
    this.isUserScrolling = value;
    if (value) {
      this.lyricsContainer?.classList.add("user-scrolling");
      this.clearProgressiveBlurLine();
    } else {
      this.lyricsContainer?.classList.remove("user-scrolling");
    }
    if (changed) this.dispatchEvent(new CustomEvent("lyric-following-change", {
      detail: { following: !value },
    }));
  }
  handleUserScroll() {
    this.setUserScrolling(true);
    this.clearPastLineHighlights();
    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
      this.userScrollTimeoutId = undefined;
    }
    this.scheduleViewportSync();
  }
  scheduleViewportSync() {
    if (this.userScrollTimeoutId) clearTimeout(this.userScrollTimeoutId);
    this.userScrollTimeoutId = undefined;
    if (!this.isUserScrolling || !this.lyricsContainer) return;
    this.userScrollTimeoutId = setTimeout(() => {
      this.userScrollTimeoutId = undefined;
      if (!this.isConnected || !this.isUserScrolling || !this.lyricsContainer) return;
      const bounds = this.lyricsContainer.getBoundingClientRect();
      const visible = this.activeLineIndices.some(index => {
        const line = this._getLineElement(index);
        if (!line) return false;
        const rect = line.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
      if (visible) this.resumeFollowing();
    }, LYRIC_MANUAL_SCROLL_SETTLE_MS);
  }
  resumeFollowing() {
    this.setUserScrolling(false);
    if (this.activeLineIndices.length > 0) {
      this._handleActiveLineScroll(true);
    } else {
      const currentGap = this.findInstrumentalGapAt(this.currentTime);
      if (currentGap) {
        this.scrollToInstrumental(currentGap.insertBeforeIndex, true);
      }
    }
  }
  clearPastLineHighlights() {
    if (!this.lyricsContainer) return;
    const lineElements = this.cachedLineArray.length
      ? this.cachedLineArray
      : Array.from(
          this.lyricsContainer.querySelectorAll(
            ".lyrics-line:not(.lyrics-gap)",
          ),
        );
    for (const line of lineElements) {
      if (
        !line.classList.contains("active") &&
        line.classList.contains("persist-highlight")
      ) {
        LyricsRuntime.unfinishSyllables(line);
      }
    }
  }
  getLineIndexAtTime(timeMs, startHintIndex = 0) {
    if (!this.lyrics || this.lyrics.length === 0) return -1;
    const len = this.lyrics.length;
    const hint = Math.max(0, Math.min(startHintIndex, len - 1));
    for (let i = hint; i < len; i += 1) {
      const line = this.lyrics[i];
      if (line.timestamp > timeMs) break;
      if (timeMs >= line.timestamp && timeMs < line.endtime) {
        return i;
      }
    }
    for (let i = hint - 1; i >= 0; i -= 1) {
      const line = this.lyrics[i];
      if (timeMs >= line.timestamp && timeMs < line.endtime) {
        return i;
      }
      if (line.endtime < timeMs) break;
    }
    for (let i = 0; i < len; i += 1) {
      const line = this.lyrics[i];
      if (line.timestamp > timeMs) break;
      if (timeMs >= line.timestamp && timeMs < line.endtime) {
        return i;
      }
    }
    return -1;
  }
  findActiveLineIndices(time) {
    if (!this.lyrics || this.lyrics.length === 0) return [];
    this.ensureTimingCache();
    const interval = this.activeTimelineInterval;
    if (interval && time >= interval.start && time < interval.end)
      return interval.indices;
    const activeLines = [];
    let start = -Infinity;
    let end = Infinity;
    for (let i = 0; i < this.lyrics.length; i += 1) {
      const line = this.lyrics[i];
      const highlightEndTime = this.getLineHighlightEndTime(i);
      if (line.timestamp > time) {
        end = Math.min(end, line.timestamp);
        break;
      }
      start = Math.max(start, line.timestamp);
      if (time >= line.timestamp && time < highlightEndTime) {
        activeLines.push(i);
        end = Math.min(end, highlightEndTime);
      } else {
        start = Math.max(start, highlightEndTime);
      }
    }
    this.activeTimelineInterval = {
      start,
      end,
      indices: activeLines,
    };
    return activeLines;
  }
  findInstrumentalGapAt(time) {
    if (!this.lyrics || this.lyrics.length === 0) return null;
    const first = this.lyrics[0];
    if (time >= 0 && time < first.timestamp) {
      const gapStart = 0;
      const gapEnd = first.timestamp;
      if (gapEnd - gapStart >= INSTRUMENTAL_THRESHOLD_MS) {
        return {
          insertBeforeIndex: 0,
          gapStart,
          gapEnd,
        };
      }
      return null;
    }
    for (let i = 0; i < this.lyrics.length - 1; i += 1) {
      const curr = this.lyrics[i];
      const next = this.lyrics[i + 1];
      const gapStart = curr.endtime;
      const gapEnd = next.timestamp;
      if (time > gapStart && time < gapEnd) {
        if (gapEnd - gapStart >= INSTRUMENTAL_THRESHOLD_MS) {
          return {
            insertBeforeIndex: i + 1,
            gapStart,
            gapEnd,
          };
        }
        return null;
      }
    }
    return null;
  }
  findAllInstrumentalGaps() {
    if (this.cachedAllGaps.length > 0) return this.cachedAllGaps;
    if (!this.lyrics || this.lyrics.length === 0) return [];
    const gaps = [];
    const first = this.lyrics[0];
    if (first.timestamp >= INSTRUMENTAL_THRESHOLD_MS) {
      gaps.push({
        insertBeforeIndex: 0,
        gapStart: 0,
        gapEnd: first.timestamp,
      });
    }
    for (let i = 0; i < this.lyrics.length - 1; i += 1) {
      const curr = this.lyrics[i];
      const next = this.lyrics[i + 1];
      const gapStart = curr.endtime;
      const gapEnd = next.timestamp;
      if (gapEnd - gapStart >= INSTRUMENTAL_THRESHOLD_MS) {
        gaps.push({
          insertBeforeIndex: i + 1,
          gapStart,
          gapEnd,
        });
      }
    }
    this.cachedAllGaps = gaps;
    return gaps;
  }
  handleLineClick(line) {
    if (this.cachedIsUnsynced) return;
    if (this.lyricsContainer) {
      const allLines = this.lyricsContainer.querySelectorAll(".lyrics-line");
      allLines.forEach((lineEl) => {
        LyricsRuntime.resetSyllables(lineEl);
        lineEl.classList.remove("scroll-animate", "scroll-exiting");
        lineEl.style.removeProperty("--scroll-delta");
        lineEl.style.removeProperty("--lyrics-line-delay");
      });
      this.lyricsContainer.classList.remove("wheel-scrolling");
    }
    this.cancelLineScrollAnimation();
    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
      this.userScrollTimeoutId = undefined;
    }
    this.setUserScrolling(false);
    this.currentPrimaryActiveLine = null;
    this.lastPrimaryActiveLine = null;
    this.activeLineIds.clear();
    this.setBackgroundExpandedLine(null);
    const clickedLineElement = this.lyricsContainer?.querySelector(
      `.lyrics-line[data-start-time="${line.text[0]?.timestamp || 0}"]`,
    );
    if (clickedLineElement && this.lyricsContainer) {
      this.currentPrimaryActiveLine = clickedLineElement;
      this.currentScrollOffset = -this.lyricsContainer.scrollTop;
      this.isClickSeeking = true;
      if (this.clickSeekTimeout) clearTimeout(this.clickSeekTimeout);
      this.clickSeekTimeout = setTimeout(() => {
        this.isClickSeeking = false;
      }, 800);
      this.scrollToActiveLineYouLy(clickedLineElement, true);
      this.setBackgroundExpandedLine(clickedLineElement);
    }
    const event = new CustomEvent("line-click", {
      detail: {
        timestamp: line.timestamp,
      },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }
  static getBackgroundTextPlacement(line) {
    if (
      !line.backgroundText ||
      line.backgroundText.length === 0 ||
      line.text.length === 0
    ) {
      return "after";
    }
    const mainTextStartTime = line.text[0].timestamp;
    const backgroundTextStartTime = line.backgroundText[0].timestamp;
    return backgroundTextStartTime < mainTextStartTime ? "before" : "after";
  }
  scrollToActiveLine() {
    if (!this.lyricsContainer || this.activeLineIndices.length === 0) {
      return;
    }
    const firstActiveLineIndex = Math.min(...this.activeLineIndices);
    const activeLineElement = this.lyricsContainer.querySelector(
      `.lyrics-line:nth-child(${firstActiveLineIndex + 1})`,
    );
    if (activeLineElement) {
      const containerHeight = this.lyricsContainer.clientHeight;
      const lineTop = activeLineElement.offsetTop;
      const lineHeight = activeLineElement.clientHeight;
      const hasBackgroundBefore = activeLineElement.querySelector(
        ".background-text.before",
      );
      let offsetAdjustment = 0;
      if (hasBackgroundBefore) {
        const backgroundElement = hasBackgroundBefore;
        offsetAdjustment = backgroundElement.clientHeight / 2;
      }
      const top =
        lineTop - (this.focusPosition ?? containerHeight * 0.62) + lineHeight / 2 - offsetAdjustment;
      requestAnimationFrame(() => {
        this.isProgrammaticScroll = true;
        this.lyricsContainer?.scrollTo({
          top,
          behavior: "smooth",
        });
        setTimeout(() => {
          this.isProgrammaticScroll = false;
        }, 100);
      });
    }
  }
  scrollToInstrumental(insertBeforeIndex, forceScroll = false) {
    if (!this.lyricsContainer) return;
    const gapTarget = this.lyricsContainer.querySelector(
      `#gap-${insertBeforeIndex}`,
    );
    if (gapTarget) {
      const paddingTop = this.getScrollPaddingTop(gapTarget);
      const targetTranslateY = paddingTop - gapTarget.offsetTop;
      this.isProgrammaticScroll = true;
      this.clearPastLineHighlights();
      this.animateScrollYouLy(
        targetTranslateY,
        forceScroll,
        undefined,
        gapTarget,
      );
      setTimeout(() => {
        this.isProgrammaticScroll = false;
      }, 250);
    }
  }
  getScrollPaddingTop(line = this.currentPrimaryActiveLine) {
    if (!this.lyricsContainer) return 0;
    const vocal = line?.querySelector(".main-vocal-container");
    const height = vocal?.offsetHeight ?? line?.offsetHeight ?? 0;
    return (this.focusPosition ?? this.lyricsContainer.clientHeight * 0.62) - height / 2 - (vocal?.offsetTop ?? 0);
  }
  cancelLineScrollAnimation() {
    this.lineSprings.forEach((spring, line) => {
      spring.animation.cancel();
      line.style.removeProperty("will-change");
    });
    this.lineSprings.clear();
  }
  static sampleSpring(
    position,
    velocity,
    time,
    frequency,
    damping = 0.9 * frequency,
  ) {
    const omega = Math.sqrt(frequency * frequency - damping * damping);
    const decay = Math.exp(-damping * time);
    const cos = Math.cos(omega * time);
    const sin = Math.sin(omega * time);
    return {
      position:
        decay *
        (position * cos + ((velocity + damping * position) / omega) * sin),
      velocity:
        decay *
        (velocity * cos -
          ((damping * velocity + frequency * frequency * position) / omega) *
            sin),
    };
  }
  static createLineSpringFrames(position, velocity, frequency = 10) {
    let samples = LyricsRuntime.lineSpringSamples.get(frequency);
    if (!samples) {
      samples = Array.from(
        {
          length: 97,
        },
        (_, frame) => {
          const offset = frame / 96;
          const time = 1.2 * offset;
          return {
            offset,
            fromPosition:
              frame === 96
                ? 0
                : LyricsRuntime.sampleSpring(1, 0, time, frequency).position,
            fromVelocity:
              frame === 96
                ? 0
                : LyricsRuntime.sampleSpring(0, 1, time, frequency).position,
          };
        },
      );
      LyricsRuntime.lineSpringSamples.set(frequency, samples);
    }
    return samples.map(({ offset, fromPosition, fromVelocity }) => {
      const y = position * fromPosition + velocity * fromVelocity;
      return {
        offset,
        translate: `0 ${y}px`,
      };
    });
  }
  getLayoutScrollHeight() {
    const parent = this.lyricsContainer;
    if (!parent) return 0;
    const last = this.footerElement || parent.lastElementChild;
    if (!last) return parent.scrollHeight;
    return Math.max(
      parent.clientHeight,
      last.offsetTop +
        last.offsetHeight +
        (Number.parseFloat(getComputedStyle(last).marginBottom) || 0) +
        (Number.parseFloat(getComputedStyle(parent).paddingBottom) || 0),
    );
  }
  animateScrollYouLy(
    newTranslateY,
    _forceScroll,
    _scrollDuration,
    referenceElement = null,
  ) {
    if (!this.lyricsContainer) return;
    const parent = this.lyricsContainer;
    const currentTop = parent.scrollTop;
    const requestedDelta = -newTranslateY - currentTop;
    if (this.shouldReduceMotion || this.lineMotion === "instant") {
      this.cancelLineScrollAnimation();
      parent.scrollTop = Math.max(0, -newTranslateY);
      this.currentScrollOffset = -parent.scrollTop;
      this.pendingLayoutOffsets.clear();
      return;
    }
    if (Math.abs(requestedDelta) < 0.5 && !this.pendingLayoutOffsets.size)
      return;
    const lines = this.cachedLineArray.length
      ? this.cachedLineArray
      : Array.from(parent.querySelectorAll(".lyrics-line"));
    const reference = lines.indexOf(
      referenceElement || this.currentPrimaryActiveLine || lines[0],
    );
    const retargeting = this.lineSprings.size > 0;
    const frequency = 10;
    const poses = lines.map((line, index) => {
      const previous = this.lineSprings.get(line);
      const age = previous
        ? Math.max(
            0,
            Number(previous.animation.currentTime || 0) / 1000 - previous.delay,
          )
        : 0;
      const pose = previous
        ? LyricsRuntime.sampleSpring(
            previous.position,
            previous.velocity,
            age,
            previous.frequency,
          )
        : {
            position: 0,
            velocity: 0,
          };
      const steps = requestedDelta >= 0 ? index - reference : reference - index;
      let delay = 0;
      if (this.lineMotion !== "uniform") {
        if (retargeting && previous) {
          delay = Math.max(
            0,
            previous.delay - Number(previous.animation.currentTime || 0) / 1000,
          );
        } else if (!retargeting) {
          delay = Math.max(0, Math.min(4, steps)) * 0.05;
        }
      }
      return {
        line,
        index,
        top: line.offsetTop,
        height: line.offsetHeight,
        moving: Boolean(previous),
        position: pose.position + (this.pendingLayoutOffsets.get(line) || 0),
        velocity: pose.velocity,
        delay,
      };
    });
    this.pendingLayoutOffsets.clear();
    this.cancelLineScrollAnimation();
    const target = LyricsRuntime.clamp(
      -newTranslateY,
      0,
      Math.max(0, this.getLayoutScrollHeight() - parent.clientHeight),
    );
    const delta = target - currentTop;
    const visibleStart = Math.min(currentTop, target) - 200;
    const visibleEnd = Math.max(currentTop, target) + parent.clientHeight + 200;
    parent.scrollTop = target;
    this.currentScrollOffset = -target;
    poses.forEach(
      ({
        line,
        index,
        top,
        height,
        moving,
        position: previousPosition,
        velocity,
        delay,
      }) => {
        const position = previousPosition + delta;
        if (
          Math.abs(index - reference) > 20 ||
          (!moving && (top + height < visibleStart || top > visibleEnd)) ||
          (Math.abs(position) < 0.1 && Math.abs(velocity) < 0.1)
        )
          return;
        const duration = 1.2;
        const frames = LyricsRuntime.createLineSpringFrames(
          position,
          velocity,
          frequency,
        );
        line.style.setProperty("will-change", "translate");
        const animation = line.animate(frames, {
          duration: duration * 1000,
          delay: delay * 1000,
          fill: "both",
          easing: "linear",
        });
        this.lineSprings.set(line, {
          animation,
          position,
          velocity,
          delay,
          frequency,
        });
        animation.onfinish = () => {
          if (this.lineSprings.get(line)?.animation !== animation) return;
          animation.cancel();
          line.style.removeProperty("will-change");
          this.lineSprings.delete(line);
        };
      },
    );
  }
  updatePositionClasses(lineToScroll) {
    if (!this.lyricsContainer) return;
    const positionClasses = [
      "lyrics-activest",
      "post-active-line",
      "next-active-line",
      "prev-1",
      "prev-2",
      "prev-3",
      "prev-4",
      "next-1",
      "next-2",
      "next-3",
      "next-4",
    ];
    for (const el of this.positionedLineElements) {
      el.classList.remove(...positionClasses);
    }
    this.positionedLineElements = [];
    lineToScroll.classList.add("lyrics-activest");
    this.positionedLineElements.push(lineToScroll);
    if (this.cachedLineArray.length === 0) {
      this.cachedLineArray = Array.from(
        this.lyricsContainer.querySelectorAll(".lyrics-line"),
      );
    }
    const lineElements = this.cachedLineArray;
    const scrollLineIndex = lineElements.indexOf(lineToScroll);
    if (scrollLineIndex === -1) return;
    for (
      let i = Math.max(0, scrollLineIndex - 4);
      i <= Math.min(lineElements.length - 1, scrollLineIndex + 4);
      i += 1
    ) {
      const position = i - scrollLineIndex;
      if (position !== 0) {
        const element = lineElements[i];
        if (position === -1) element.classList.add("post-active-line");
        else if (position === 1) element.classList.add("next-active-line");
        else if (position < 0)
          element.classList.add(`prev-${Math.abs(position)}`);
        else element.classList.add(`next-${position}`);
        this.positionedLineElements.push(element);
      }
    }
  }
  scrollToActiveLineYouLy(
    activeLine,
    forceScroll = false,
    scrollDuration = undefined,
  ) {
    if (!activeLine || !this.lyricsContainer) return;
    const paddingTop = this.getScrollPaddingTop(activeLine);
    const targetTop = Math.max(0, activeLine.offsetTop - paddingTop);
    const targetTranslateY = -targetTop;
    if (
      !forceScroll &&
      !this.pendingLayoutOffsets.size &&
      Math.abs(this.lyricsContainer.scrollTop - targetTop) < 1
    ) {
      return;
    }
    if (
      !forceScroll &&
      !this.pendingLayoutOffsets.size &&
      !activeLine.classList.contains("lyrics-footer")
    ) {
      const parent = this.lyricsContainer;
      const atBottom =
        parent.scrollTop + parent.clientHeight >= parent.scrollHeight - 50;
      if (atBottom && targetTop > parent.scrollTop - 50) {
        return;
      }
    }
    this.lyricsContainer.classList.remove("not-focused", "user-scrolling");
    this.isProgrammaticScroll = true;
    this.setUserScrolling(false);
    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
      this.userScrollTimeoutId = undefined;
    }
    this.clearPastLineHighlights();
    const duration = scrollDuration ?? SCROLL_ANIMATION_DURATION_MS;
    setTimeout(() => {
      this.isProgrammaticScroll = false;
    }, duration + 160);
    this.animateScrollYouLy(
      targetTranslateY,
      forceScroll,
      scrollDuration,
      activeLine,
    );
  }
  static clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  static getVisibleCharacterCount(element) {
    const attrLength = parseFloat(
      element.getAttribute("data-word-length") || "",
    );
    if (Number.isFinite(attrLength) && attrLength > 0) return attrLength;
    return (element.textContent || "").replace(/\s/g, "").length;
  }
  static getLongWordWipeScale(charCount) {
    if (charCount <= 6) return 1;
    return (
      1 +
      LyricsRuntime.clamp((charCount - 6) / 10, 0, 1) *
        LONG_WORD_WIPE_EXTRA_RATIO
    );
  }
  static applyWipeShape(element, charCount, cjk = false) {
    const extra =
      LyricsRuntime.clamp((charCount - 6) / 10, 0, 1) * LONG_WORD_WIPE_EXTRA_EM;
    const width = cjk ? CJK_WIPE_GRADIENT_EM : BASE_WIPE_GRADIENT_EM + extra;
    element.style.setProperty("--wipe-gradient-width", `${width.toFixed(3)}em`);
    element.style.setProperty(
      "--wipe-gradient-half",
      `${(width / 2).toFixed(3)}em`,
    );
  }
  static ensureWordWipeGeometry(charSpans, charCount) {
    if (charSpans.length === 0) return;
    const approxWidthCh = Math.max(1, charCount || charSpans.length);
    charSpans.forEach((span, index) => {
      if (!span.style.getPropertyValue("--word-wipe-width")) {
        span.style.setProperty("--word-wipe-width", `${approxWidthCh}ch`);
      }
      if (!span.style.getPropertyValue("--char-wipe-position")) {
        const startPct = index / Math.max(1, charSpans.length);
        span.style.setProperty(
          "--char-wipe-position",
          `${-(LyricsRuntime.clamp(startPct, 0, 1) * approxWidthCh)}ch`,
        );
      }
    });
  }
  static clearPreHighlight(syllable) {
    const word = LyricsRuntime.getWordElementForSyllable(syllable);
    if (word) LyricsRuntime.clearWordWipe(word);
    const target = syllable;
    target.classList.remove("pre-highlight");
    target.style.removeProperty("--pre-wipe-duration");
    target.style.removeProperty("--pre-wipe-delay");
    target.style.animation = "";
    target
      .querySelectorAll(".pre-wipe-lead")
      .forEach((element) => LyricsRuntime.clearPreWipeLead(element));
    LyricsRuntime.getCachedVirtualWordElements(
      LyricsRuntime.getWordElementForSyllable(syllable),
    ).forEach((element) => {
      const wordTarget = element;
      wordTarget._wordPreWipeKey = undefined;
    });
  }
  static clearPreWipeLead(element) {
    element.classList.remove("pre-wipe-lead");
    element.style.removeProperty("--pre-wipe-duration");
    element.style.removeProperty("--pre-wipe-delay");
  }
  static hasTextBoundaryAfter(syllable) {
    return /\s$/.test(syllable.textContent || "");
  }
  static getSyllableWordIndex(syllable) {
    const wordElement = LyricsRuntime.getWordElementForSyllable(syllable);
    const virtualWordId = wordElement?.dataset.virtualWordId;
    if (virtualWordId) {
      return `virtual:${virtualWordId}`;
    }
    const virtualWordStart = wordElement?.dataset.virtualWordStart;
    const virtualWordEnd = wordElement?.dataset.virtualWordEnd;
    if (virtualWordStart || virtualWordEnd) {
      return `virtual:${virtualWordStart || ""}:${virtualWordEnd || ""}`;
    }
    return (
      syllable.getAttribute("data-word-index") ||
      syllable.getAttribute("data-syllable-index") ||
      ""
    );
  }
  static getNextWordSyllable(syllables, index) {
    const current = syllables[index];
    const currentWordIndex = LyricsRuntime.getSyllableWordIndex(current);
    const previousSyllable = current;
    const currentVocalTrack = LyricsRuntime.getVocalTrack(current);
    for (let i = index + 1; i < syllables.length; i += 1) {
      const candidate = syllables[i];
      if (LyricsRuntime.getVocalTrack(candidate) !== currentVocalTrack) {
        return null;
      }
      if (candidate.classList.contains("transliteration")) {
        continue;
      }
      const candidateWordIndex = LyricsRuntime.getSyllableWordIndex(candidate);
      if (
        candidateWordIndex === currentWordIndex ||
        (!LyricsRuntime.hasTextBoundaryAfter(previousSyllable) &&
          !/^\s/.test(candidate.textContent || ""))
      ) {
        return null;
      }
      return candidate;
    }
    return null;
  }
  static getPreviousNonTransliterationSyllable(syllables, index) {
    const currentVocalTrack = LyricsRuntime.getVocalTrack(syllables[index]);
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = syllables[i];
      if (LyricsRuntime.getVocalTrack(candidate) !== currentVocalTrack) {
        return null;
      }
      if (!candidate.classList.contains("transliteration")) {
        return candidate;
      }
    }
    return null;
  }
  static getVocalTrack(syllable) {
    const target = syllable;
    if (target._cachedVocalTrack === undefined) {
      target._cachedVocalTrack = syllable.closest(
        ".main-vocal-container, .background-vocal-container",
      );
    }
    return target._cachedVocalTrack;
  }
  static getRenderedWordSyllables(syllable) {
    const wordElement = LyricsRuntime.getWordElementForSyllable(syllable);
    const wordElements =
      LyricsRuntime.getCachedVirtualWordElements(wordElement);
    const wordSyllables = wordElements.flatMap((element) =>
      Array.from(element.querySelectorAll(".lyrics-syllable")),
    );
    return wordSyllables.filter(
      (wordSyllable) => !wordSyllable.classList.contains("transliteration"),
    );
  }
  static getWordWipe(syllable) {
    if (
      syllable.classList.contains("line-synced") ||
      syllable.classList.contains("transliteration")
    )
      return undefined;
    const words = LyricsRuntime.getCachedVirtualWordElements(
      LyricsRuntime.getWordElementForSyllable(syllable),
    );
    const word = words[0];
    if (!word) return undefined;
    const cached = LyricsRuntime.wordWipes.get(word);
    if (cached) return cached;
    const syllables = LyricsRuntime.getRenderedWordSyllables(syllable);
    const fragments = [];
    const segments = [];
    let width = 0;
    for (const segment of syllables) {
      const chars = LyricsRuntime.getCachedCharSpans(segment);
      const targets = chars.length ? chars : [segment];
      let segmentWidth = 0;
      for (const element of targets) {
        const style = getComputedStyle(element);
        const fragmentWidth = Number.parseFloat(style.width);
        if (!Number.isFinite(fragmentWidth) || fragmentWidth <= 0) continue;
        fragments.push({
          element,
          width: fragmentWidth,
          offset: width,
          fontSize: Number.parseFloat(style.fontSize),
          padding: Math.max(
            Number.parseFloat(style.paddingLeft) || 0,
            Number.parseFloat(style.paddingRight) || 0,
          ),
        });
        width += fragmentWidth;
        segmentWidth += fragmentWidth;
      }
      segments.push({
        start: Number(segment.dataset.startTime),
        end: Number(segment.dataset.endTime),
        width: segmentWidth,
      });
    }
    if (!width || !segments.length) return undefined;
    const start = Math.min(...segments.map((segment) => segment.start));
    let end = Math.max(start + 1, ...segments.map((segment) => segment.end));
    const nextWord = words[words.length - 1].nextElementSibling;
    const nextStart = Number(nextWord?.dataset.virtualWordStart);
    if (nextStart > start) end = Math.min(end, nextStart);
    const text = syllables
      .map((segment) => segment.textContent || "")
      .join("")
      .replace(/\s/g, "");
    const wipe = {
      syllables,
      fragments,
      segments,
      width,
      count: splitLyricGraphemes(text).length,
      cjk: /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text),
      start,
      end,
      rtl: syllable.classList.contains("rtl-text"),
      animations: [],
      epoch: start,
      prepared: false,
      settled: false,
    };
    words.forEach((element) => LyricsRuntime.wordWipes.set(element, wipe));
    return wipe;
  }
  static startWordWipe(wipe, time, epoch = wipe.start, restore = false) {
    if (wipe.animations.length) {
      if (restore) {
        for (const animation of wipe.animations) {
          if (animation.playState !== "idle") continue;
          animation.play();
          animation.currentTime = Math.max(
            0,
            Math.min(
              time - wipe.epoch,
              Number(animation.effect?.getComputedTiming().endTime),
            ),
          );
        }
        wipe.settled = false;
      }
      return;
    }
    if (wipe.settled && !restore) return;
    const startEpoch = Math.min(epoch, wipe.start);
    const duration = Math.max(1, wipe.end - startEpoch);
    const stops = [];
    if (startEpoch < wipe.start)
      stops.push({
        offset: 0,
        progress: 0,
        pre: true,
      });
    stops.push({
      offset: (wipe.start - startEpoch) / duration,
      progress: 0,
    });
    let previousEnd = wipe.start;
    let progress = 0;
    for (const segment of wipe.segments) {
      const start = LyricsRuntime.clamp(segment.start, previousEnd, wipe.end);
      const end = LyricsRuntime.clamp(segment.end, start, wipe.end);
      if (start > previousEnd)
        stops.push({
          offset: (start - startEpoch) / duration,
          progress,
        });
      progress += segment.width;
      stops.push({
        offset: (end - startEpoch) / duration,
        progress,
      });
      previousEnd = end;
    }
    stops.push({
      offset: 1,
      progress: wipe.width,
    });
    const wordWipe = wipe;
    wordWipe.epoch = startEpoch;
    wordWipe.prepared = true;
    wordWipe.settled = false;
    wipe.syllables.forEach((syllable) => {
      const target = syllable;
      target.style.animation = "none";
    });
    for (const {
      element,
      width,
      offset,
      fontSize,
      padding,
    } of wipe.fragments) {
      LyricsRuntime.applyWipeShape(element, wipe.count, wipe.cjk);
      element.style.setProperty("--word-wipe-width", `${wipe.width}px`);
      element.style.backgroundColor = "var(--lyplus-text-secondary)";
      element.style.backgroundSize = `calc(${wipe.width}px + var(--wipe-gradient-width, 0.75em)) 100%`;
      element.style.animation = "none";
      element.classList.add("shared-word-wipe");
      element.classList.toggle("word-wipe-rtl", wipe.rtl);
      const feather =
        fontSize *
        Number.parseFloat(
          element.style.getPropertyValue("--wipe-gradient-width"),
        );
      const lower = offset - feather - padding;
      const upper = offset + width + padding;
      const positions = stops.map((stop) => ({
        offset: stop.offset,
        edge: stop.progress - (stop.pre ? feather : 0),
      }));
      const samples = [];
      positions.forEach((stop, index) => {
        const previous = positions[index - 1];
        if (previous && stop.edge > previous.edge) {
          for (const edge of [lower, upper]) {
            if (edge > previous.edge && edge < stop.edge)
              samples.push({
                offset:
                  previous.offset +
                  ((edge - previous.edge) / (stop.edge - previous.edge)) *
                    (stop.offset - previous.offset),
                edge,
              });
          }
        }
        samples.push(stop);
      });
      const frames = samples.map((stop) => {
        const edge = LyricsRuntime.clamp(stop.edge, lower, upper);
        const x = wipe.rtl
          ? width + offset - edge - feather
          : -offset - wipe.width + edge;
        return {
          offset: stop.offset,
          backgroundPosition: `${x}px 0%`,
        };
      });
      const finalPosition = frames[frames.length - 1].backgroundPosition;
      element.style.backgroundPosition = finalPosition;
      if (time >= wipe.end && !restore) continue;
      let first = 0;
      let last = frames.length - 1;
      while (
        first < last &&
        frames[first].backgroundPosition ===
          frames[first + 1].backgroundPosition
      )
        first += 1;
      while (
        last > first &&
        frames[last].backgroundPosition === frames[last - 1].backgroundPosition
      )
        last -= 1;
      if (first === last) continue;
      const from = frames[first].offset;
      const range = frames[last].offset - from;
      const localFrames =
        range > 0
          ? frames.slice(first, last + 1).map((frame) => ({
              ...frame,
              offset: (frame.offset - from) / range,
            }))
          : frames;
      const animation = element.animate(localFrames, {
        delay: range > 0 ? from * duration : 0,
        duration: range > 0 ? range * duration : duration,
        easing: "linear",
        fill: "both",
      });
      animation.currentTime = Math.max(
        0,
        Math.min(
          time - startEpoch,
          range > 0 ? frames[last].offset * duration : duration,
        ),
      );
      LyricsRuntime.wipeClocks.set(animation, startEpoch);
      wipe.animations.push(animation);
      animation.onfinish = () => {
        if (!wordWipe.prepared || !wordWipe.animations.includes(animation))
          return;
        animation.cancel();
        wordWipe.settled = wordWipe.animations.every(
          (effect) => effect.playState === "idle",
        );
      };
    }
    if (!wipe.animations.length) wordWipe.settled = true;
  }
  static clearWordWipe(word) {
    const wipe = LyricsRuntime.wordWipes.get(word);
    if (!wipe || !wipe.prepared) return;
    wipe.animations.forEach((animation) => animation.cancel());
    wipe.animations = [];
    wipe.prepared = false;
    wipe.settled = false;
    wipe.fragments.forEach(({ element }) => {
      element.classList.remove("shared-word-wipe", "word-wipe-rtl");
      element.style.removeProperty("background-color");
      element.style.removeProperty("background-size");
      element.style.removeProperty("background-position");
      element.style.removeProperty("animation");
    });
  }
  static getWordElementForSyllable(syllable) {
    return syllable.parentElement?.parentElement;
  }
  static getWordPreWipeKey(syllable) {
    const wordElement = LyricsRuntime.getWordElementForSyllable(syllable);
    return (
      wordElement?.dataset.virtualWordId ||
      `${syllable.getAttribute("data-start-time") || ""}:${LyricsRuntime.getSyllableWordIndex(syllable)}`
    );
  }
  static isPreWipeArmed(syllable) {
    const wordElement = LyricsRuntime.getWordElementForSyllable(syllable);
    const target = wordElement;
    return Boolean(
      target?._wordPreWipeKey === LyricsRuntime.getWordPreWipeKey(syllable),
    );
  }
  static applyWordPreWipe(nextSyllable, currentTimeMs, preWipeStartMs) {
    if (LyricsRuntime.isPreWipeArmed(nextSyllable)) return;
    const wipe = LyricsRuntime.getWordWipe(nextSyllable);
    if (!wipe) return;
    LyricsRuntime.startWordWipe(wipe, currentTimeMs, preWipeStartMs);
    nextSyllable.classList.add("pre-highlight");
    LyricsRuntime.getCachedVirtualWordElements(
      LyricsRuntime.getWordElementForSyllable(nextSyllable),
    ).forEach((element) => {
      const target = element;
      target._wordPreWipeKey = LyricsRuntime.getWordPreWipeKey(nextSyllable);
    });
  }
  static getWordPreWipeDuration(
    syllable,
    wordSyllables = LyricsRuntime.getRenderedWordSyllables(syllable),
  ) {
    const renderedSyllables =
      wordSyllables.length > 0 ? wordSyllables : [syllable];
    const wordElement = LyricsRuntime.getWordElementForSyllable(syllable);
    const charSpans = LyricsRuntime.getCachedVirtualWordCharSpans(
      wordElement,
      [],
    );
    const charCount =
      charSpans.length ||
      renderedSyllables.reduce(
        (total, wordSyllable) =>
          total + (wordSyllable.textContent || "").replace(/\s/g, "").length,
        0,
      );
    if (charCount <= 0) return 0;
    return LyricsRuntime.clamp(
      64 + charCount * 9,
      NEXT_WORD_PRE_WIPE_MIN_DURATION_MS,
      NEXT_WORD_PRE_WIPE_MAX_DURATION_MS,
    );
  }
  static maybePreWipeNextWord(
    syllables,
    index,
    currentTimeMs,
    currentEndTimeMs,
  ) {
    const syllable = syllables[index];
    const currentWipe = LyricsRuntime.getWordWipe(syllable);
    const wordEndTime = currentWipe?.end ?? currentEndTimeMs;
    if (
      syllable.classList.contains("line-synced") ||
      syllable.classList.contains("transliteration") ||
      syllable.closest(".lyrics-gap")
    ) {
      return;
    }
    const currentWordReady =
      syllable.classList.contains("finished") ||
      currentTimeMs >= wordEndTime - WORD_PRE_WIPE_HANDOFF_LEAD_MS;
    if (!currentWordReady) return;
    const nextSyllable = LyricsRuntime.getNextWordSyllable(syllables, index);
    if (
      !nextSyllable ||
      nextSyllable.classList.contains("line-synced") ||
      nextSyllable.classList.contains("transliteration") ||
      nextSyllable.closest(".lyrics-gap") ||
      nextSyllable.classList.contains("highlight") ||
      nextSyllable.classList.contains("finished")
    ) {
      return;
    }
    const nextStartTimeMs = nextSyllable._cachedStartTime;
    if (!Number.isFinite(nextStartTimeMs)) return;
    const gapMs = nextStartTimeMs - wordEndTime;
    if (gapMs > NEXT_WORD_PRE_WIPE_MAX_GAP_MS || gapMs < 0) {
      return;
    }
    const nextWordSyllables =
      LyricsRuntime.getRenderedWordSyllables(nextSyllable);
    const preWipeSyllables =
      nextWordSyllables.length > 0 ? nextWordSyllables : [nextSyllable];
    const preWipeDuration = LyricsRuntime.getWordPreWipeDuration(
      nextSyllable,
      preWipeSyllables,
    );
    if (preWipeDuration <= 0) return;
    const preWipeStart = Math.max(
      nextStartTimeMs - preWipeDuration,
      wordEndTime - WORD_PRE_WIPE_HANDOFF_LEAD_MS,
    );
    if (currentTimeMs < preWipeStart || currentTimeMs >= nextStartTimeMs) {
      return;
    }
    if (LyricsRuntime.isPreWipeArmed(nextSyllable)) return;
    LyricsRuntime.applyWordPreWipe(nextSyllable, currentTimeMs, preWipeStart);
  }
  static getCachedCharSpans(element) {
    const cacheTarget = element;
    if (!cacheTarget._cachedCharSpans) {
      cacheTarget._cachedCharSpans = Array.from(
        element.querySelectorAll("span.char"),
      );
    }
    return cacheTarget._cachedCharSpans;
  }
  static getCachedVirtualWordElements(wordElement) {
    if (!wordElement) return [];
    const cacheTarget = wordElement;
    if (cacheTarget._cachedVirtualWordElements) {
      return cacheTarget._cachedVirtualWordElements;
    }
    const { virtualWordId } = wordElement.dataset;
    let wordElements = [wordElement];
    if (virtualWordId && wordElement.parentElement) {
      wordElements = Array.from(
        wordElement.parentElement.querySelectorAll(".lyrics-word"),
      ).filter((el) => el.dataset.virtualWordId === virtualWordId);
    }
    wordElements.forEach((element) => {
      const target = element;
      target._cachedVirtualWordElements = wordElements;
    });
    return wordElements;
  }
  static getCachedVirtualWordCharSpans(wordElement, fallbackCharSpans) {
    if (!wordElement) return fallbackCharSpans;
    const cacheTarget = wordElement;
    if (cacheTarget._cachedVirtualWordCharSpans) {
      return cacheTarget._cachedVirtualWordCharSpans;
    }
    const wordElements =
      LyricsRuntime.getCachedVirtualWordElements(wordElement);
    const charSpans = wordElements.flatMap((word) =>
      Array.from(word.querySelectorAll("span.char")),
    );
    const result = charSpans.length > 0 ? charSpans : fallbackCharSpans;
    wordElements.forEach((element) => {
      const target = element;
      target._cachedVirtualWordCharSpans = result;
    });
    return result;
  }
  static updateSyllableAnimation(syllable, elapsedTimeMs = 0) {
    if (syllable.classList.contains("highlight")) return;
    if (
      !syllable.classList.contains("transliteration") &&
      !syllable.closest(".lyrics-gap")
    ) {
      const wipe = LyricsRuntime.getWordWipe(syllable);
      if (wipe) {
        LyricsRuntime.startWordWipe(
          wipe,
          Number(syllable.dataset.startTime) + elapsedTimeMs,
        );
        syllable.classList.remove("pre-highlight");
        syllable.classList.add("highlight");
        return;
      }
    }
    const { classList } = syllable;
    const hadPreHighlight = classList.contains("pre-highlight");
    const isRTL = classList.contains("rtl-text");
    const charSpans = LyricsRuntime.getCachedCharSpans(syllable);
    const isFirstSyllable =
      syllable.getAttribute("data-syllable-index") === "0";
    const isFirstInContainer = isFirstSyllable;
    const isGap = syllable.closest(".lyrics-gap") !== null;
    const syllableDurationMs =
      parseFloat(syllable.getAttribute("data-duration") || "0") || 300;
    const charAnimationsMap = new Map();
    if (charSpans.length > 0) {
      LyricsRuntime.applyWipeShape(syllable, charSpans.length);
      LyricsRuntime.ensureWordWipeGeometry(charSpans, charSpans.length);
      const animation = `char-word-wipe ${syllableDurationMs}ms linear ${-elapsedTimeMs}ms both`;
      charSpans.forEach((span) => {
        LyricsRuntime.applyWipeShape(span, charSpans.length);
        charAnimationsMap.set(span, animation);
      });
    } else {
      const wipeRatio = parseFloat(
        syllable.getAttribute("data-wipe-ratio") || "1",
      );
      const wipeCharCount = LyricsRuntime.getVisibleCharacterCount(syllable);
      const wipeScale = LyricsRuntime.getLongWordWipeScale(wipeCharCount);
      const nominalVisualDuration = syllableDurationMs * wipeRatio * wipeScale;
      const visualDuration = Math.min(
        syllableDurationMs,
        nominalVisualDuration,
      );
      LyricsRuntime.applyWipeShape(syllable, wipeCharCount);
      let wipeAnimation = "wipe";
      if (hadPreHighlight) {
        wipeAnimation = isRTL ? "wipe-from-pre-rtl" : "wipe-from-pre";
      } else if (isFirstInContainer) {
        wipeAnimation = isRTL ? "start-wipe-rtl" : "start-wipe";
      } else {
        wipeAnimation = isRTL ? "wipe-rtl" : "wipe";
      }
      if (syllable.classList.contains("line-synced")) return;
      const currentWipeAnimation = isGap ? "fade-gap" : wipeAnimation;
      syllable.style.animation = `${currentWipeAnimation} ${visualDuration}ms ${isGap ? "ease-out" : "linear"} ${-elapsedTimeMs}ms forwards`;
    }
    LyricsRuntime.getCachedVirtualWordElements(
      LyricsRuntime.getWordElementForSyllable(syllable),
    ).forEach((element) => {
      const target = element;
      target._wordPreWipeKey = undefined;
    });
    classList.remove("pre-highlight");
    classList.add("highlight");
    charSpans.forEach((span) => LyricsRuntime.clearPreWipeLead(span));
    for (const [span, animationString] of charAnimationsMap.entries()) {
      span.style.removeProperty("background-color");
      span.style.animation = animationString;
    }
  }
  static resetSyllable(syllable) {
    if (!syllable) return;
    syllable.style.animation = "";
    syllable.style.removeProperty("--pre-wipe-duration");
    syllable.style.removeProperty("--pre-wipe-delay");
    syllable.style.transition = "none";
    syllable.style.backgroundColor = syllable.classList.contains("has-chars")
      ? "transparent"
      : "var(--lyplus-text-secondary)";
    const charSpans = syllable.querySelectorAll("span.char");
    for (let i = 0; i < charSpans.length; i += 1) {
      const el = charSpans[i];
      el.style.animation = "";
      LyricsRuntime.clearCharacterMotion(el);
      el.style.transition = "none";
      el.style.backgroundColor = "var(--lyplus-text-secondary)";
      LyricsRuntime.clearPreWipeLead(el);
    }
    syllable.classList.remove(
      "highlight",
      "finished",
      "pre-highlight",
      "cleanup",
    );
  }
  static resetWordAnimationState(line, preserveNormalRise = false) {
    const wordElements = line.querySelectorAll(".lyrics-word");
    wordElements.forEach((wordElement) => {
      LyricsRuntime.clearWordWipe(wordElement);
      if (
        !preserveNormalRise ||
        wordElement.matches(".growable, .char-rise, .char-drag")
      )
        wordElement.classList.remove("word-started");
      const target = wordElement;
      target._wordPreWipeKey = undefined;
    });
  }
  static resetSyllables(line) {
    if (!line) return;
    line.classList.remove("persist-highlight");
    LyricsRuntime.resetWordAnimationState(line);
    line._cachedSyllableElements = null;
    const syllables = line.getElementsByClassName("lyrics-syllable");
    for (let i = 0; i < syllables.length; i += 1) {
      LyricsRuntime.resetSyllable(syllables[i]);
    }
    requestAnimationFrame(() => {
      for (let i = 0; i < syllables.length; i += 1) {
        const syllable = syllables[i];
        if (!syllable.classList.contains("shared-word-wipe"))
          syllable.style.removeProperty("background-color");
        syllable.style.removeProperty("transition");
        const chars = syllable.querySelectorAll("span.char");
        for (let j = 0; j < chars.length; j += 1) {
          const el = chars[j];
          if (!el.classList.contains("shared-word-wipe"))
            el.style.removeProperty("background-color");
          el.style.removeProperty("transition");
          el.style.removeProperty("will-change");
        }
      }
    });
  }
  static unfinishSyllables(line) {
    if (!line) return;
    line.classList.remove("persist-highlight");
    LyricsRuntime.resetWordAnimationState(line, true);
    const syllables = line.getElementsByClassName("lyrics-syllable");
    for (let i = 0; i < syllables.length; i += 1) {
      const s = syllables[i];
      s.classList.remove("highlight", "finished", "pre-highlight", "cleanup");
      s.style.animation = "";
      s.style.removeProperty("--pre-wipe-duration");
      s.style.removeProperty("--pre-wipe-delay");
      s.style.removeProperty("background-color");
      s.style.removeProperty("transition");
      const chars = s.querySelectorAll("span.char");
      for (let j = 0; j < chars.length; j += 1) {
        const el = chars[j];
        el.style.animation = "";
        el.removeAttribute("data-glow");
        el.style.removeProperty("will-change");
        el.style.removeProperty("background-color");
        el.style.removeProperty("transition");
        el.style.removeProperty("filter");
        LyricsRuntime.clearPreWipeLead(el);
      }
    }
  }
  static clearCharacterMotion(char) {
    const entry = LyricsRuntime.characterAnimations.get(char);
    if (!entry) return;
    entry.animation.cancel();
    if (entry.settled) {
      const target = char.parentElement?.classList.contains("char-motion")
        ? char.parentElement
        : char;
      target.style.removeProperty("transform");
    }
    LyricsRuntime.characterAnimations.delete(char);
    char.classList.remove("native-motion");
    char.removeAttribute("data-glow");
  }
  static resumeCharacterMotion(char, elapsed) {
    const entry = LyricsRuntime.characterAnimations.get(char);
    if (!entry?.settled) return;
    const target = char.parentElement?.classList.contains("char-motion")
      ? char.parentElement
      : char;
    target.style.removeProperty("transform");
    entry.settled = false;
    entry.animation.play();
    entry.animation.currentTime = elapsed;
  }
  static updateCharacterMotion(line, timeMs) {
    let syllables = LyricsRuntime.motionSyllables.get(line);
    if (!syllables) {
      const seen = new Set();
      syllables = Array.from(
        line.querySelectorAll(".lyrics-syllable.has-chars"),
      ).filter((syllable) => {
        const word = LyricsRuntime.getWordElementForSyllable(syllable);
        const key = word?.classList.contains("char-rise")
          ? syllable
          : LyricsRuntime.getCachedVirtualWordElements(word)[0] || syllable;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      LyricsRuntime.motionSyllables.set(line, syllables);
    }
    syllables.forEach((syllable) => {
      let parameters = LyricsRuntime.motionParameters.get(syllable);
      if (!parameters) {
        const word = LyricsRuntime.getWordElementForSyllable(syllable);
        const cjk = word?.classList.contains("char-rise") ?? false;
        const localChars = LyricsRuntime.getCachedCharSpans(syllable);
        const chars = cjk
          ? localChars
          : LyricsRuntime.getCachedVirtualWordCharSpans(word, localChars);
        const start = Number(
          cjk
            ? syllable.dataset.startTime
            : (word?.dataset.virtualWordStart ?? syllable.dataset.startTime),
        );
        const end = Number(
          cjk
            ? syllable.dataset.endTime
            : (word?.dataset.virtualWordEnd ?? syllable.dataset.endTime),
        );
        parameters = {
          chars,
          duration: Math.max(0.001, (end - start) / 1000),
          start,
          cjk,
        };
        LyricsRuntime.motionParameters.set(syllable, parameters);
      }
      const { chars, duration, start, cjk } = parameters;
      const count = chars.length;
      if (!count) return;
      const elapsed = timeMs - start;
      const staggerMs = ((duration * 1000) / count) * (cjk ? 0.4 : 0.35);
      const delayMs = cjk
        ? Math.min(staggerMs, 50, 200 / count)
        : Math.min(staggerMs, 350);
      const hold = (2 * duration) / count;
      const response = Math.min(3, duration);
      const emphasis = cjk ? 0 : LyricsRuntime.clamp(duration - 1, 0, 1);
      if (!emphasis) return;
      const spanDuration = Math.max(hold + response * 2, cjk ? 3 : 0);
      chars.forEach((char, index) => {
        const startDelay = (index + 1) * delayMs;
        if (elapsed < startDelay) {
          LyricsRuntime.clearCharacterMotion(char);
          return;
        }
        const motionDurationMs = Math.max(1, duration * 1000 - startDelay);
        const end = duration * 1000;
        const key = parameters;
        let entry = LyricsRuntime.characterAnimations.get(char);
        if (!entry || entry.key !== key) {
          LyricsRuntime.clearCharacterMotion(char);
          const frameKey = `${duration}:${count}:${emphasis ? index : 0}:${cjk}`;
          let frames = LyricsRuntime.characterFrames.get(frameKey);
          if (!frames) {
            frames = Array.from(
              {
                length: 61,
              },
              (_, frame) => {
                const time = (spanDuration * frame) / 60;
                const release = LyricsRuntime.clamp((frame / 60 - 0.45) / 0.55, 0, 1);
                const envelope =
                  frame === 60
                    ? 0
                    : LyricsRuntime.springProgress(time, response) *
                      (1 - release * release * (3 - 2 * release));
                const x =
                  (index - (count - 1) / 2) * 0.5 * 0.1 * emphasis * envelope;
                return {
                  offset: frame / 60,
                  transform: `translateX(calc(${x}em * var(--am-lyrics-lift))) scale(${1 + 0.1 * emphasis * envelope})`,
                };
              },
            );
            if (LyricsRuntime.characterFrames.size >= 64) {
              LyricsRuntime.characterFrames.delete(
                LyricsRuntime.characterFrames.keys().next().value,
              );
            }
            LyricsRuntime.characterFrames.set(frameKey, frames);
          }
          char.classList.add("native-motion");
          const motionTarget = char.parentElement?.classList.contains(
            "char-motion",
          )
            ? char.parentElement
            : char;
          const animation = motionTarget.animate(frames, {
            duration: motionDurationMs,
            delay: startDelay,
            fill: "both",
            easing: "linear",
          });
          animation.currentTime = Math.min(elapsed, end);
          entry = {
            animation,
            start,
            end,
            key,
            settled: false,
            finalTransform: frames[frames.length - 1].transform,
          };
          LyricsRuntime.characterAnimations.set(char, entry);
          const motion = entry;
          animation.onfinish = () => {
            if (LyricsRuntime.characterAnimations.get(char) !== motion) return;
            motionTarget.style.transform = motion.finalTransform;
            motion.settled = true;
            char.removeAttribute("data-glow");
            animation.cancel();
          };
        } else if (entry.settled) {
          if (elapsed < entry.end)
            LyricsRuntime.resumeCharacterMotion(char, elapsed);
        } else if (
          Math.abs(
            Number(entry.animation.currentTime) - Math.min(elapsed, entry.end),
          ) > 200
        ) {
          entry.animation.currentTime = Math.min(elapsed, entry.end);
          if (elapsed < entry.end && entry.animation.playState === "finished")
            entry.animation.play();
        }
      });
    });
  }
  static springProgress(time, response) {
    if (time <= 0) return 0;
    const phase = (2 * Math.PI * time) / Math.max(0.001, response);
    return 1 - (1 + phase) * Math.exp(-phase);
  }
  static seekLineWipes(line, time) {
    for (const word of LyricsRuntime.motionWords.get(line) || []) {
      if (
        word.wipe &&
        time < word.wipe.end &&
        (word.wipe.settled ||
          word.wipe.animations.some(
            (animation) => animation.playState === "idle",
          ))
      )
        LyricsRuntime.startWordWipe(word.wipe, time, word.wipe.epoch, true);
    }
    line
      .getAnimations({
        subtree: true,
      })
      .forEach((animation) => {
        const epoch = LyricsRuntime.wipeClocks.get(animation);
        if (epoch !== undefined) {
          const timeline = animation;
          const end = Number(animation.effect?.getComputedTiming().endTime);
          const elapsed = time - epoch;
          timeline.currentTime = Math.min(elapsed, end);
          if (elapsed < end && animation.playState !== "running") {
            animation.play();
            timeline.currentTime = elapsed;
          }
          return;
        }
        if (
          !("animationName" in animation) ||
          !String(animation.animationName).includes("wipe")
        )
          return;
        const effect = animation.effect;
        const syllable = effect.target?.closest(".lyrics-syllable");
        if (!syllable) return;
        const elapsed =
          time -
          Number(syllable.dataset.startTime) +
          Number(effect.getTiming().delay);
        const end = Number(effect.getComputedTiming().endTime);
        const timeline = animation;
        timeline.currentTime = Math.min(elapsed, end);
        if (elapsed < end && animation.playState !== "running") {
          animation.play();
          timeline.currentTime = elapsed;
        }
      });
  }
  static updateSyllablesForLine(line, currentTimeMs, reduceMotion = false) {
    let words = LyricsRuntime.motionWords.get(line);
    if (!words) {
      words = Array.from(
        line.querySelectorAll(".lyrics-word[data-virtual-word-start]"),
      ).map((element) => {
        const syllable = element.querySelector(".lyrics-syllable");
        return {
          element,
          start: Number(element.dataset.virtualWordStart),
          wipe: syllable ? LyricsRuntime.getWordWipe(syllable) : undefined,
        };
      });
      LyricsRuntime.motionWords.set(line, words);
    }
    words.forEach(({ element, start, wipe }) => {
      const started = currentTimeMs >= start;
      if (element.classList.contains("word-started") !== started)
        element.classList.toggle("word-started", started);
      if (!started) return;
      if (wipe) LyricsRuntime.startWordWipe(wipe, currentTimeMs);
    });
    if (!reduceMotion) LyricsRuntime.updateCharacterMotion(line, currentTimeMs);
    let syllables = line._cachedSyllableElements;
    if (!syllables) {
      syllables = Array.from(line.querySelectorAll(".lyrics-syllable"));
      for (let i = 0; i < syllables.length; i += 1) {
        const syllable = syllables[i];
        syllable._cachedStartTime = parseFloat(
          syllable.getAttribute("data-start-time") || "0",
        );
        syllable._cachedEndTime = parseFloat(
          syllable.getAttribute("data-end-time") || "0",
        );
      }
      line._cachedSyllableElements = syllables;
    }
    for (let i = 0; i < syllables.length; i += 1) {
      const syllable = syllables[i];
      const startTime = syllable._cachedStartTime;
      const endTime = syllable._cachedEndTime;
      if (Number.isFinite(startTime) && Number.isFinite(endTime)) {
        const { classList } = syllable;
        const hasHighlight = classList.contains("highlight");
        const hasFinished = classList.contains("finished");
        const hasPreHighlight = classList.contains("pre-highlight");
        const hasActiveState = hasHighlight || hasFinished || hasPreHighlight;
        if (!(currentTimeMs < startTime - 1000 && !hasActiveState)) {
          let preHighlightReset = false;
          if (hasPreHighlight && currentTimeMs < startTime) {
            const prevSyllable =
              LyricsRuntime.getPreviousNonTransliterationSyllable(syllables, i);
            const previousCarriesHighlight =
              prevSyllable?.classList.contains("highlight") ||
              prevSyllable?.classList.contains("finished");
            const preview = LyricsRuntime.getWordWipe(syllable);
            if (
              !previousCarriesHighlight ||
              (preview && currentTimeMs < preview.epoch)
            ) {
              LyricsRuntime.clearPreHighlight(syllable);
              preHighlightReset = true;
            }
          }
          if (!preHighlightReset) {
            if (currentTimeMs >= startTime && currentTimeMs <= endTime) {
              if (!hasHighlight) {
                LyricsRuntime.updateSyllableAnimation(
                  syllable,
                  currentTimeMs - startTime,
                );
              }
              if (hasFinished) {
                classList.remove("finished");
              }
            } else if (currentTimeMs > endTime) {
              if (!hasFinished) {
                if (!hasHighlight) {
                  LyricsRuntime.updateSyllableAnimation(
                    syllable,
                    currentTimeMs - startTime,
                  );
                }
                classList.add("finished");
                if (syllable.classList.contains("shared-word-wipe"))
                  syllable.style.removeProperty("background-color");
                LyricsRuntime.getCachedCharSpans(syllable).forEach((char) => {
                  if (char.classList.contains("shared-word-wipe"))
                    char.style.removeProperty("background-color");
                });
              }
            } else if (hasHighlight || hasFinished) {
              const wipe = LyricsRuntime.getWordWipe(syllable);
              if (wipe && currentTimeMs >= wipe.start) {
                classList.remove("highlight", "finished", "cleanup");
              } else {
                const word = LyricsRuntime.getWordElementForSyllable(syllable);
                if (word) LyricsRuntime.clearWordWipe(word);
                LyricsRuntime.resetSyllable(syllable);
              }
            }
            LyricsRuntime.maybePreWipeNextWord(
              syllables,
              i,
              currentTimeMs,
              endTime,
            );
          }
        }
      }
    }
  }
  render() {
    if (this.fontFamily) {
      this.style.fontFamily = this.fontFamily;
    }
    this.style.setProperty("--highlight-color", this.highlightColor);
    const sourceLabel = this.lyricsSource ?? "Unavailable";
    const isUnsynced = this.cachedIsUnsynced;
    const hasLeftAlignedLines = this.lyrics?.some(
      (line) => line.alignment !== "end",
    );
    const hasRightAlignedLines = this.lyrics?.some(
      (line) => line.alignment === "end",
    );
    const hasDuetLines = hasLeftAlignedLines && hasRightAlignedLines;
    const renderContent = () => {
      if (this.isLoading) {
        return html`
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
        `;
      }
      if (!this.lyrics || this.lyrics.length === 0) {
        return html`<div class="no-lyrics">No lyrics found.</div>`;
      }
      const allGaps = this.findAllInstrumentalGaps();
      const gapByIndex = new Map(allGaps.map((g) => [g.insertBeforeIndex, g]));
      return this.lyrics.map((line, lineIndex) => {
        const lineId = `lyrics-line-${lineIndex}`;
        const lineStartTime = line.text[0]?.timestamp || 0;
        const lineEndTime = line.text[line.text.length - 1]?.endtime || 0;
        const hasBackground =
          line.backgroundText && line.backgroundText.length > 0;
        const bgPlacement = hasBackground
          ? LyricsRuntime.getBackgroundTextPlacement(line)
          : "after";
        const backingWords = [];
        const backing = line.backgroundText || [];
        for (let first = 0; first < backing.length;) {
          let last = first;
          while (
            last + 1 < backing.length &&
            !/\s$/.test(backing[last].text) &&
            !/^\s/.test(backing[last + 1].text)
          )
            last += 1;
          const word = {
            text: backing
              .slice(first, last + 1)
              .map((syllable) => syllable.text)
              .join(""),
            start: backing[first].timestamp,
            end: backing[last].endtime,
          };
          for (let index = first; index <= last; index += 1)
            backingWords[index] = word;
          first = last + 1;
        }
        const lineIsRTL = this.cachedLineData?.[lineIndex]?.lineIsRTL ?? false;
        const backgroundVocalElement = hasBackground
          ? html`<p
              class="background-vocal-container background-${bgPlacement}"
            >
              <span class="background-vocal-wrap">
                ${line.backgroundText.map((syllable, syllableIndex) => {
                  const startTimeMs = syllable.timestamp;
                  const endTimeMs = syllable.endtime;
                  const durationMs = endTimeMs - startTimeMs;
                  const bgRomanizedText =
                    this.showRomanization &&
                    syllable.romanizedText &&
                    syllable.romanizedText.trim() !== syllable.text.trim()
                      ? html`<span
                          class="lyrics-syllable transliteration no-chars ${syllable.lineSynced ? "line-synced" : ""}"
                          data-start-time="${startTimeMs}"
                          data-end-time="${endTimeMs}"
                          data-duration="${durationMs}"
                          data-syllable-index="0"
                          data-wipe-ratio="1"
                          >${syllable.romanizedText}</span
                        >`
                      : "";
                  const backingWord = backingWords[syllableIndex];
                  const bgChars =
                    !syllable.lineSynced &&
                    LyricsRuntime.characterMotionMode(
                      backingWord.text,
                      backingWord.end - backingWord.start,
                      true,
                    ) !== "none"
                      ? splitLyricGraphemes(syllable.text.replace(/\s/g, ""))
                      : [];
                  let bgCharIndex = 0;
                  return html`<span
                    class="lyrics-word${bgChars.length ? " char-rise" : ""}"
                    data-virtual-word-id="bg-${lineIndex}-${backingWord.start}"
                    data-virtual-word-start="${backingWord.start}"
                    data-virtual-word-end="${backingWord.end}"
                    ><span
                      class="lyrics-syllable-wrap${bgRomanizedText ? " has-transliteration" : ""}"
                      ><span
                        class="lyrics-syllable${lineIsRTL ? " rtl-text" : ""} ${bgChars.length ? "has-chars" : "no-chars"}${syllable.lineSynced ? " line-synced" : ""}"
                        data-start-time="${startTimeMs}"
                        data-end-time="${endTimeMs}"
                        data-duration="${durationMs}"
                        data-syllable-index="0"
                        data-word-index="${syllableIndex}"
                        data-word-length="${splitLyricGraphemes(syllable.text.replace(/\s/g, "")).length}"
                        data-wipe-ratio="1"
                        >${
                          bgChars.length
                            ? splitLyricGraphemes(syllable.text).map((char) => {
                                if (/\s/.test(char)) return char;
                                const index = bgCharIndex;
                                bgCharIndex += 1;
                                return html`<span class="char-motion"
                                  ><span
                                    class="char"
                                    data-syllable-char-index="${index}"
                                    data-wipe-start="${index / bgChars.length}"
                                    data-wipe-duration="${1 / bgChars.length}"
                                    >${char}</span
                                  ></span
                                >`;
                              })
                            : syllable.text
                        }</span
                      >${bgRomanizedText}</span
                    ></span
                  >`;
                })}
              </span>
            </p>`
          : "";
        const lineData = this.cachedLineData?.[lineIndex];
        const wordGroups = lineData?.wordGroups ?? [];
        const groupGrowable = lineData?.groupGrowable ?? [];
        const groupGlowing = lineData?.groupGlowing ?? [];
        const groupCharRise = lineData?.groupCharRise ?? [];
        const groupCharDrag = lineData?.groupCharDrag ?? [];
        const vwFullDuration = lineData?.vwFullDuration ?? [];
        const vwCharOffset = lineData?.vwCharOffset ?? [];
        const vwStartMs = lineData?.vwStartMs ?? [];
        const vwEndMs = lineData?.vwEndMs ?? [];
        const mainVocalElement = html`<p
          class="main-vocal-container ${lineIsRTL ? "rtl-text" : ""}"
        >
          ${wordGroups.map((group, groupIdx) => {
            const isGrowable = groupGrowable[groupIdx];
            const isGlowing = groupGlowing[groupIdx];
            const isCharRise = groupCharRise[groupIdx];
            const isCharDrag = groupCharDrag[groupIdx];
            const isAnimatedByChar = isGrowable || isCharRise || isCharDrag;
            const groupLineSynced =
              line.isWordSynced === false || group.some((s) => s.lineSynced);
            const wordDuration = isAnimatedByChar
              ? vwFullDuration[groupIdx]
              : 0;
            const groupCharOffset = isAnimatedByChar
              ? vwCharOffset[groupIdx]
              : 0;
            const virtualWordId = `${lineIndex}:${vwStartMs[groupIdx]}:${vwEndMs[groupIdx]}`;
            const virtualWordStart = vwStartMs[groupIdx];
            const virtualWordEnd = vwEndMs[groupIdx];
            let sylCharAccumulator = 0;
            const groupText = group.map((s) => s.text).join("");
            const visibleWordLength = splitLyricGraphemes(groupText.replace(/\s/g, "")).length;
            const shouldAllowBreak =
              groupText.trim().length >= 16 ||
              /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(
                groupText,
              );
            return html`<span
              class="lyrics-word${isGrowable ? " growable" : ""}${isCharRise ? " char-rise" : ""}${isCharDrag ? " char-drag" : ""}${isGlowing ? " glowing" : ""}${shouldAllowBreak ? " allow-break" : ""}"
              data-virtual-word-id="${virtualWordId}"
              data-virtual-word-start="${virtualWordStart}"
              data-virtual-word-end="${virtualWordEnd}"
              >${group.map((syllable, sylIdx) => {
                const startTimeMs = syllable.timestamp;
                const endTimeMs = syllable.endtime;
                const durationMs = endTimeMs - startTimeMs;
                const text = syllable.text || "";
                const romanizedText =
                  this.showRomanization &&
                  syllable.romanizedText &&
                  syllable.romanizedText.trim() !== syllable.text.trim()
                    ? html`<span
                        class="lyrics-syllable transliteration no-chars ${groupLineSynced ? "line-synced" : ""}"
                        data-start-time="${startTimeMs}"
                        data-end-time="${endTimeMs}"
                        data-duration="${durationMs}"
                        data-syllable-index="0"
                        data-wipe-ratio="1"
                        >${syllable.romanizedText}</span
                      >`
                    : "";
                const animateSyllable = isAnimatedByChar && !groupLineSynced;
                let syllableContent = text;
                if (animateSyllable) {
                  const numCharsInSyllable =
                    splitLyricGraphemes(text.replace(/\s/g, "")).length || 1;
                  let charIndexInsideSyllable = 0;
                  syllableContent = html`${splitLyricGraphemes(text).map((char) => {
                    if (char === " ") return " ";
                    const charIndexInsideWord =
                      groupCharOffset + sylCharAccumulator;
                    const localCharIndex = charIndexInsideSyllable;
                    sylCharAccumulator += 1;
                    charIndexInsideSyllable += 1;
                    return html`<span class="char-motion"
                      ><span
                        class="char"
                        data-char-index="${charIndexInsideWord}"
                        data-syllable-char-index="${charIndexInsideWord}"
                        style="--word-wipe-width: ${numCharsInSyllable}ch; --char-wipe-position: -${localCharIndex}ch"
                        >${char}</span
                      ></span
                    >`;
                  })}`;
                }
                return html`<span
                  class="lyrics-syllable-wrap${romanizedText ? " has-transliteration" : ""}"
                  ><span
                    class="lyrics-syllable${lineIsRTL ? " rtl-text" : ""}${groupLineSynced ? " line-synced" : ""}${animateSyllable ? " has-chars" : " no-chars"}"
                    data-start-time="${startTimeMs}"
                    data-end-time="${endTimeMs}"
                    data-duration="${durationMs}"
                    data-word-duration="${wordDuration}"
                    data-syllable-index="${sylIdx}"
                    data-word-index="${groupIdx}"
                    data-word-length="${visibleWordLength}"
                    data-wipe-ratio="1"
                    >${syllableContent}</span
                  >${romanizedText}</span
                >`;
              })}</span
            >`;
          })}
        </p>`;
        const fullLineText = line.text
          .map((s) => s.text)
          .join("")
          .trim();
        const translationElement =
          this.showTranslation &&
          line.translation &&
          line.translation.trim() !== fullLineText
            ? html`<div class="lyrics-translation-container">
                ${line.translation}
              </div>`
            : "";
        const lineRomanizationElement =
          this.showRomanization &&
          line.romanizedText &&
          !line.text.some((s) => s.romanizedText) &&
          line.romanizedText.trim() !== fullLineText
            ? html`<div
                class="lyrics-romanization-container ${lineIsRTL ? "rtl-text" : ""}"
              >
                ${line.romanizedText}
              </div>`
            : "";
        let maybeInstrumentalBlock = null;
        const gapForLine = gapByIndex.get(lineIndex);
        if (gapForLine) {
          maybeInstrumentalBlock = html`<div id="gap-${lineIndex}" class="lyrics-line lyrics-gap" aria-hidden="true" data-start-time="${gapForLine.gapStart}" data-end-time="${gapForLine.gapEnd}"><p class="main-vocal-container"><span class="lyric-instrumental-note">♪</span></p></div>`;
        }
        return html`
          ${maybeInstrumentalBlock}
          <div
            id="${lineId}"
            class="lyrics-line ${line.alignment === "end" ? "singer-right" : "singer-left"} ${lineIsRTL ? "rtl-text" : ""} ${hasBackground ? `bg-${bgPlacement}` : ""}"
            role="${isUnsynced ? "paragraph" : "button"}"
            aria-label="${isUnsynced ? fullLineText : `Seek to lyric: ${fullLineText}`}"
            data-start-time="${lineStartTime}"
            data-end-time="${lineEndTime}"
            @click="${() => this.handleLineClick(line)}"
            tabindex="${isUnsynced ? -1 : 0}"
            @keydown="${(e) => {
              if (e.key === "Enter" || e.key === " ") {
                this.handleLineClick(line);
              }
            }}"
          >
            <div class="lyrics-line-container ${lineIsRTL ? "rtl-text" : ""}">
              ${bgPlacement === "before" ? backgroundVocalElement : ""}
              ${mainVocalElement}
              ${bgPlacement === "after" ? backgroundVocalElement : ""}
              ${lineRomanizationElement} ${translationElement}
            </div>
          </div>
        `;
      });
    };
    return html`
      <div
        class="lyrics-container ${isUnsynced ? "is-unsynced" : ""} ${!isUnsynced && !this.noBlur ? "blur-inactive-enabled" : ""} ${hasDuetLines ? "has-duet-lines" : ""} ${this.shouldReduceMotion ? "reduced-motion" : ""}"
        role="region"
        aria-label="Synced lyrics"
      >
        ${renderContent()}
        ${
          !this.isLoading
            ? html`
                <footer class="lyrics-footer lyrics-line">
                  <div class="footer-content">
                    <span
                      class="source-info"
                      style="display: flex; align-items: center; gap: 8px;"
                    >
                      <b style="font-weight: 750;">Source</b> ${sourceLabel}
                      ${
                        (this.availableSources &&
                          this.availableSources.length > 1) ||
                        !this.hasFetchedAllProviders
                          ? html`
                              <button
                                type="button"
                                class="download-button source-switch-btn"
                                title="Switch Lyrics Source"
                                aria-label="Switch lyrics source"
                                @click="${this.switchSource}"
                                ?disabled="${this.isFetchingAlternatives}"
                              >
                                <svg
                                  class="source-switch-svg lucide lucide-arrow-down-up-icon lucide-arrow-down-up ${this.isFetchingAlternatives ? "is-loading" : ""}"
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                >
                                  ${
                                    this.isFetchingAlternatives
                                      ? svg`<path
                                    d="M21 12a9 9 0 1 1-6.219-8.56"
                                  ></path>`
                                      : svg`<path d="m3 16 4 4 4-4"></path
                                    ><path d="M7 20V4"></path
                                    ><path d="m21 8-4-4-4 4"></path
                                    ><path d="M17 4v16"></path>`
                                  }
                                </svg>
                                <span class="source-switch-label"
                                  >${this.isFetchingAlternatives ? "Switching..." : "Switch"}</span
                                >
                              </button>
                            `
                          : ""
                      }
                    </span>
                    ${this.songwriters ? html`<span class="songwriters-info" style="margin-top: 4px; font-weight: normal; font-size: 0.9em;"> <b style="font-weight: 750;">Songwriters</b> ${this.songwriters} </span>` : ""}
                    <span class="version-info" style="margin-top: 8px;">
                      <b style="font-weight: 750;">am-lyrics</b> v${VERSION} •
                      <a
                        href="https://github.com/uimaxbai/apple-music-web-components"
                        target="_blank"
                        rel="noopener noreferrer"
                        style="display: inline-flex; align-items: center; gap: 4px;"
                        >Star me on GitHub
                      </a>
                    </span>
                  </div>
                </footer>
              `
            : ""
        }
      </div>
    `;
  }
}
LyricsRuntime.styles = lyricStyles;
LyricsRuntime.lineSpringSamples = new Map();
LyricsRuntime.wordWipes = new WeakMap();
LyricsRuntime.wipeClocks = new WeakMap();
LyricsRuntime.motionWords = new WeakMap();
LyricsRuntime.motionSyllables = new WeakMap();
LyricsRuntime.motionParameters = new WeakMap();
LyricsRuntime.characterFrames = new Map();
LyricsRuntime.characterAnimations = new WeakMap();
decorate(
  [
    property({
      type: String,
    }),
  ],
  LyricsRuntime.prototype,
  "query",
  void 0,
);
decorate(
  [
    property({
      type: String,
    }),
  ],
  LyricsRuntime.prototype,
  "musicId",
  void 0,
);
decorate(
  [
    property({
      type: String,
    }),
  ],
  LyricsRuntime.prototype,
  "isrc",
  void 0,
);
decorate(
  [
    property({
      type: String,
    }),
  ],
  LyricsRuntime.prototype,
  "ttml",
  void 0,
);
decorate(
  [
    property({
      type: String,
      attribute: "song-title",
    }),
  ],
  LyricsRuntime.prototype,
  "songTitle",
  void 0,
);
decorate(
  [
    property({
      type: String,
      attribute: "song-artist",
    }),
  ],
  LyricsRuntime.prototype,
  "songArtist",
  void 0,
);
decorate(
  [
    property({
      type: String,
      attribute: "song-album",
    }),
  ],
  LyricsRuntime.prototype,
  "songAlbum",
  void 0,
);
decorate(
  [
    property({
      type: String,
      attribute: "songwriters",
    }),
  ],
  LyricsRuntime.prototype,
  "songwriters",
  void 0,
);
decorate(
  [
    property({
      type: Number,
      attribute: "song-duration",
    }),
  ],
  LyricsRuntime.prototype,
  "songDurationMs",
  void 0,
);
decorate(
  [
    property({
      type: String,
      attribute: "highlight-color",
    }),
  ],
  LyricsRuntime.prototype,
  "highlightColor",
  void 0,
);
decorate(
  [
    property({
      type: String,
      attribute: "font-family",
    }),
  ],
  LyricsRuntime.prototype,
  "fontFamily",
  void 0,
);
decorate(
  [
    property({
      type: Boolean,
    }),
  ],
  LyricsRuntime.prototype,
  "autoScroll",
  void 0,
);
decorate(
  [
    property({
      type: Boolean,
    }),
  ],
  LyricsRuntime.prototype,
  "interpolate",
  void 0,
);
decorate(
  [
    property({
      type: Boolean,
      attribute: "no-auto-alternates",
    }),
  ],
  LyricsRuntime.prototype,
  "noAutoAlternates",
  void 0,
);
decorate(
  [
    property({
      type: Boolean,
      attribute: "no-blur",
      reflect: true,
    }),
  ],
  LyricsRuntime.prototype,
  "noBlur",
  void 0,
);
decorate(
  [
    property({
      type: Boolean,
      attribute: "hide-played-lines",
      reflect: true,
    }),
  ],
  LyricsRuntime.prototype,
  "hidePlayedLines",
  void 0,
);
decorate(
  [
    property({
      type: Boolean,
      attribute: "reduced-motion",
    }),
  ],
  LyricsRuntime.prototype,
  "reducedMotion",
  void 0,
);
decorate(
  [
    property({
      type: String,
      attribute: "line-motion",
    }),
  ],
  LyricsRuntime.prototype,
  "lineMotion",
  void 0,
);
decorate([state()], LyricsRuntime.prototype, "systemReducedMotion", void 0);
decorate([state()], LyricsRuntime.prototype, "showRomanization", void 0);
decorate([state()], LyricsRuntime.prototype, "showTranslation", void 0);
decorate(
  [
    property({
      type: Number,
    }),
  ],
  LyricsRuntime.prototype,
  "duration",
  void 0,
);
decorate(
  [
    property({
      type: Number,
      attribute: "currenttime",
      hasChanged: () => false,
    }),
  ],
  LyricsRuntime.prototype,
  "currentTime",
  null,
);
decorate([state()], LyricsRuntime.prototype, "isLoading", void 0);
decorate([state()], LyricsRuntime.prototype, "lyrics", void 0);
decorate([state()], LyricsRuntime.prototype, "lyricsSource", void 0);
decorate([state()], LyricsRuntime.prototype, "availableSources", void 0);
decorate([state()], LyricsRuntime.prototype, "currentSourceIndex", void 0);
decorate(
  [query(".lyrics-container")],
  LyricsRuntime.prototype,
  "lyricsContainer",
  void 0,
);
window.customElements.define("am-lyrics", LyricsRuntime);
export {};
