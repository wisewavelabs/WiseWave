import { css } from "./renderCore.js";

export const lyricStyles = css`
  :host {
    --lyplus-lyrics-palette: var(
      --am-lyrics-highlight-color,
      var(--highlight-color, #fff)
    );
    --lyplus-text-primary: var(--lyplus-lyrics-palette);
    --lyplus-text-secondary: color-mix(
      in srgb,
      var(--lyplus-lyrics-palette),
      transparent 45%
    );
    --lyplus-padding-base: 1em;
    --lyplus-padding-line: 10px;
    --lyplus-padding-gap: 0.3em;
    --lyplus-border-radius-base: 0.6em;
    --lyplus-gap-dot-size: 0.4em;
    --lyplus-gap-dot-margin: 0.08em;
    --lyplus-font-size-base: 34px;
    --lyplus-font-size-base-grow: 24.5;
    --lyplus-font-size-subtext: 0.6em;
    --am-lyrics-line-height: 1.2;
    --am-lyrics-line-spacing: 25px;
    --am-lyrics-background-vocal-spacing: 15px;
    --am-lyrics-background-vocal-font-size: 0.65em;
    --am-lyrics-background-vocal-stack-shift: 7.5px;
    --am-lyrics-background-vocal-max-height: 8em;
    --am-lyrics-background-vocal-enter-duration: 0.6s;
    --am-lyrics-background-vocal-exit-duration: 0.6s;
    --am-lyrics-instrumental-height: 40px;
    --am-lyrics-instrumental-spacing: 16px;
    --am-lyrics-instrumental-enter-duration: 0.4s;
    --am-lyrics-instrumental-collapse-duration: 0.5s;
    --am-lyrics-instrumental-exit-duration: 0.35s;
    --am-lyrics-instrumental-exit-scale: 0;
    --am-lyrics-inactive-scale: 0.98;
    --am-lyrics-background-vocal-scale: 0;
    --am-lyrics-touch-scale: 0.96;
    --am-lyrics-highlight-radius: 16px;
    --am-lyrics-highlight-surface: #ffffff14;
    --am-lyrics-progression-feather: 30px;
    --am-lyrics-inline-padding: 20px;
    --am-lyrics-lift: 1;
    --char-rise-y: 0px;
    --am-lyrics-character-rise-peak: -1.25px;
    --lyplus-blur-amount: 0.07em;
    --lyplus-blur-amount-near: 0.035em;
    --lyplus-fade-gap-timing-function: ease-out;
    --wipe-gradient-width: var(--am-lyrics-progression-feather);
    --wipe-gradient-half: calc(var(--am-lyrics-progression-feather)/2);
    --lyrics-scroll-padding-top: 50%;
    height: 100%;
    color: var(--lyplus-text-primary);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    background: 0 0;
    font-family:
      -apple-system,
      BlinkMacSystemFont,
      Segoe UI,
      Roboto,
      Oxygen,
      Ubuntu,
      Cantarell,
      Open Sans,
      Helvetica Neue,
      sans-serif;
    font-weight: 700;
    display: block;
    overflow: hidden;
    container-type: size;
  }
  .lyrics-container {
    padding: 60px var(--am-lyrics-inline-padding)
      calc(
        var(--am-lyrics-instrumental-height) +
          var(--am-lyrics-instrumental-spacing)
      );
    padding-block-start: 62cqh;
    -webkit-overflow-scrolling: touch;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    box-sizing: border-box;
    scrollbar-width: none;
    overflow-anchor: none;
    overscroll-behavior-y: contain;
    width: 100%;
    height: 100%;
    max-height: 100vh;
    background-color: #0000;
    scroll-padding-block-start: var(--lyrics-scroll-padding-top);
    position: relative;
    overflow-y: auto;
  }
  .lyrics-container::-webkit-scrollbar {
    display: none;
  }
  .lyrics-container.touch-scrolling .lyrics-line,
  .lyrics-container.touch-scrolling .lyrics-plus-metadata {
    filter: none !important;
    transition: none !important;
  }
  .lyrics-container.wheel-scrolling .lyrics-line {
    filter: none !important;
    transition: transform 0.3s ease-out !important;
  }
  .lyrics-container.user-scrolling .lyrics-line {
    --lyrics-line-delay: 0s !important;
    transition-delay: 0s !important;
  }
  .lyrics-line {
    isolation: isolate;
    padding: 0 var(--lyplus-padding-line);
    opacity: 0.8;
    color: var(--lyplus-text-secondary);
    font-size: var(--lyplus-font-size-base);
    line-height: var(--am-lyrics-line-height);
    cursor: pointer;
    transform-origin: 0;
    transition:
      opacity 0.7s ease,
      transform 0.4s cubic-bezier(0.41, 0, 0.12, 0.99)
        var(--lyrics-line-delay, 0s),
      filter 0.7s ease;
    contain: layout style;
    text-rendering: optimizeLegibility;
    margin-block-end: var(--am-lyrics-line-spacing);
    position: relative;
  }
  .lyrics-line:before {
    content: "";
    z-index: -1;
    border-radius: var(--am-lyrics-highlight-radius);
    background: var(--am-lyrics-highlight-surface);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 0.18s cubic-bezier(0.2, 0, 0, 1),
      transform 0.18s cubic-bezier(0.2, 0, 0, 1),
      box-shadow 0.18s ease-out;
    position: absolute;
    inset: -6px -8px;
    transform: scale(0.98);
    box-shadow: 0 0 0 1px #0000;
  }
  .lyrics-line:focus-visible {
    outline: none;
  }
  .lyrics-line:focus-visible:before {
    opacity: 1;
    box-shadow: 0 0 0 2px
      color-mix(in srgb, var(--lyplus-text-primary) 72%, transparent);
    transform: scale(1);
  }
  .lyrics-line {
    animation: none;
  }
  .lyrics-line-container {
    overflow-wrap: break-word;
    transform-origin: 0;
    transform: translateZ(0) scale(var(--am-lyrics-inactive-scale));
    transition:
      transform 0.7s,
      background-color 0.7s,
      color 0.7s;
    position: relative;
  }
  .lyrics-container.focus-mode .lyrics-line:not(.lyrics-gap):not(.lyrics-footer) {
    opacity: var(--focus-opacity, 0.08) !important;
  }
  .lyrics-container.focus-mode .lyrics-line-container {
    transform: scale(var(--focus-scale, 0.6)) !important;
    transition: transform 0.5s ease;
  }
  .lyrics-container.focus-mode .lyrics-syllable.line-synced {
    opacity: 1 !important;
  }
  @media (prefers-reduced-motion: reduce) {
    .lyrics-container.focus-mode .lyrics-line-container {
      transition: none;
    }
  }
  .lyrics-line.active .lyrics-line-container,
  .lyrics-line.pre-active .lyrics-line-container {
    transition:
      transform 0.5s,
      background-color 0.18s,
      color 0.18s;
    transform: translateZ(0) scale(1);
  }
  .main-vocal-container {
    transform-origin: 5%;
    transition: transform var(--scroll-duration, 0.4s)
      cubic-bezier(0.2, 0.8, 0.2, 1);
    margin: 0;
  }
  .background-vocal-container {
    --word-inactive-color: color-mix(
      in srgb,
      var(--lyplus-text-primary) 20%,
      transparent
    );
    --word-wipe-color: var(--lyplus-text-primary);
    height: 0;
    font-size: var(--am-lyrics-background-vocal-font-size);
    box-sizing: border-box;
    color: color-mix(in srgb, var(--lyplus-text-secondary) 80%, transparent);
    pointer-events: none;
    margin: 0;
    padding: 0;
    line-height: 1.22;
    position: relative;
    overflow: visible;
  }
  .background-vocal-wrap {
    opacity: 0;
    transform: translateY(-50%)
      scale(var(--am-lyrics-background-vocal-scale));
    transform-origin: 0 var(--background-vocal-anchor, 0%);
    clip-path: inset(100% 0 0 0);
    padding-top: 0.08em;
    padding-bottom: 0.14em;
    display: block;
  }
  .lyrics-line.singer-right .background-vocal-container,
  .lyrics-line.rtl-text .background-vocal-container {
    margin-left: auto;
    margin-right: 0;
  }
  .lyrics-line.bg-expanded .background-vocal-container {
    height: var(
      --am-lyrics-background-vocal-height,
      var(--am-lyrics-background-vocal-max-height)
    );
  }
  .lyrics-line.bg-expanded .background-vocal-wrap {
    opacity: 0.6;
    transform: translateY(0) scale(1);
    clip-path: inset(0 0 0 0);
  }
  .lyrics-line.bg-collapsing .background-vocal-container {
    height: 0;
  }
  .lyrics-line.bg-collapsing .background-vocal-wrap {
    opacity: 0;
    transform: translateY(-50%)
      scale(var(--am-lyrics-background-vocal-scale));
    clip-path: inset(100% 0 0 0);
  }
  .background-vocal-container.background-after .background-vocal-wrap {
    padding-top: calc(var(--am-lyrics-background-vocal-spacing) + 0.08em);
  }
  .background-vocal-container.background-before .background-vocal-wrap {
    --background-vocal-anchor: 100%;
    padding-bottom: calc(var(--am-lyrics-background-vocal-spacing) + 0.14em);
  }
  .lyrics-line:not(.bg-expanded) .background-before .background-vocal-wrap {
    clip-path: inset(0 0 100% 0);
  }
  .lyrics-line.singer-right .background-vocal-wrap,
  .lyrics-line.rtl-text .background-vocal-wrap {
    transform-origin: 100% var(--background-vocal-anchor, 0%);
  }
  .lyrics-container.user-scrolling .background-vocal-container,
  .lyrics-container.user-scrolling .background-vocal-wrap,
  .lyrics-container.touch-scrolling .background-vocal-container,
  .lyrics-container.touch-scrolling .background-vocal-wrap {
    transition-duration: 1ms !important;
  }
  .lyrics-line.active {
    opacity: 1;
    color: var(--lyplus-text-primary);
  }
  .lyrics-line.pre-active {
    opacity: 1;
    transition:
      opacity 0.7s ease,
      transform 0.4s cubic-bezier(0.41, 0, 0.12, 0.99)
        var(--lyrics-line-delay, 0s);
  }
  .lyrics-line.scroll-exiting {
    opacity: 0.8;
    color: var(--lyplus-text-secondary);
    filter: blur(var(--lyplus-blur-amount-near));
    transition:
      opacity var(--scroll-duration, 0.4s) cubic-bezier(0.41, 0, 0.12, 0.99),
      transform var(--scroll-duration, 0.4s) cubic-bezier(0.41, 0, 0.12, 0.99)
        var(--lyrics-line-delay, 0s),
      filter var(--scroll-duration, 0.4s) ease;
  }
  .lyrics-line.persist-highlight .lyrics-syllable.finished,
  .lyrics-line.persist-highlight .lyrics-syllable.finished span.char {
    transition: none !important;
  }
  .lyrics-line.singer-right {
    text-align: end;
  }
  .lyrics-line.singer-right .lyrics-line-container,
  .lyrics-line.singer-right .main-vocal-container {
    transform-origin: 100%;
  }
  .lyrics-line.rtl-text {
    transform-origin: 100%;
    direction: rtl;
    text-align: right !important;
  }
  .lyrics-line.rtl-text .lyrics-line-container,
  .lyrics-line.rtl-text .main-vocal-container {
    transform-origin: 100%;
  }
  .lyrics-line.rtl-text .lyrics-romanization-container,
  .lyrics-line.rtl-text .lyrics-translation-container {
    text-align: right;
  }
  .lyrics-container.has-duet-lines .lyrics-line.singer-left {
    padding-inline-end: max(var(--lyplus-padding-line), 15%);
  }
  .lyrics-container.has-duet-lines .lyrics-line.singer-right {
    padding-inline-start: max(var(--lyplus-padding-line), 15%);
  }
  .lyrics-container.is-unsynced .lyrics-line {
    cursor: default;
    opacity: 1 !important;
    color: var(--lyplus-text-primary) !important;
    filter: none !important;
    transform: none !important;
  }
  .lyrics-container.is-unsynced .lyrics-line-container {
    background-color: #0000 !important;
    transform: none !important;
  }
  .lyrics-container.is-unsynced .lyrics-syllable {
    color: var(--lyplus-text-primary) !important;
    background-color: #0000 !important;
    -webkit-background-clip: unset !important;
    background-clip: unset !important;
    -webkit-text-fill-color: unset !important;
    text-fill-color: unset !important;
    filter: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  @media (hover: hover) and (pointer: fine) {
    .lyrics-line:hover {
      filter: none !important;
    }
    .lyrics-line:not(.lyrics-gap):hover {
      opacity: 1;
    }
    .lyrics-container .lyrics-line:not(.lyrics-gap):hover .lyrics-syllable.no-chars,
    .lyrics-container .lyrics-line:not(.lyrics-gap):hover .lyrics-syllable span.char {
      color: var(--lyplus-text-primary) !important;
      -webkit-text-fill-color: var(--lyplus-text-primary) !important;
    }
    .lyrics-container .lyrics-line:not(.lyrics-gap):hover .lyrics-syllable.line-synced {
      opacity: 1;
    }
    .lyrics-container.is-unsynced .lyrics-line:hover {
      background: 0 0 !important;
    }
  }
  .lyrics-line:not(.lyrics-gap):active .lyrics-line-container {
    transform: translateZ(0) scale(var(--am-lyrics-touch-scale));
    transition-duration: 0.12s;
  }
  .lyrics-container.blur-inactive-enabled:not(.not-focused)
    .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap) {
    filter: blur(var(--lyplus-blur-amount));
  }
  .lyrics-line.far-line {
    filter: none !important;
    will-change: auto !important;
    animation: none !important;
  }
  .lyrics-container.blur-inactive-enabled:not(.not-focused)
    .lyrics-line.post-active-line:not(.lyrics-gap):not(.active):not(
      .pre-active
    ),
  .lyrics-container.blur-inactive-enabled:not(.not-focused)
    .lyrics-line.next-active-line:not(.lyrics-gap):not(.active):not(
      .pre-active
    ),
  .lyrics-container.blur-inactive-enabled:not(.not-focused)
    .lyrics-line.lyrics-activest:not(.active):not(.lyrics-gap):not(
      .pre-active
    ) {
    filter: blur(var(--lyplus-blur-amount-near));
  }
  .lyrics-line.prev-2,
  .lyrics-line.next-2 {
    opacity: 0.7;
  }
  .lyrics-line.prev-3,
  .lyrics-line.next-3 {
    opacity: 0.58;
  }
  .lyrics-line.prev-4,
  .lyrics-line.next-4 {
    opacity: 0.46;
  }
  .lyrics-container.blur-inactive-enabled:not(.not-focused)
    .lyrics-line.next-active-line:not(.lyrics-gap):not(.active):not(
      .pre-active
    ),
  .lyrics-container.blur-inactive-enabled:not(.not-focused)
    .lyrics-line.next-2:not(.lyrics-gap):not(.active):not(.pre-active) {
    filter: blur(0.028em);
  }
  .lyrics-container.blur-inactive-enabled:not(.not-focused)
    .lyrics-line.next-3:not(.lyrics-gap):not(.active):not(.pre-active) {
    filter: blur(0.05em);
  }
  .lyrics-container.blur-inactive-enabled:not(.not-focused)
    .lyrics-line.next-4:not(.lyrics-gap):not(.active):not(.pre-active) {
    filter: blur(var(--lyplus-blur-amount));
  }
  .lyrics-container.user-scrolling .lyrics-line {
    filter: none !important;
    opacity: 0.8 !important;
    transition: none !important;
  }
  .lyrics-container.blur-inactive-enabled
    .lyrics-line.pre-active:not(.progressive-unblur) {
    opacity: 1;
    filter: none !important;
  }
  .lyrics-line.progressive-unblur {
    transition:
      opacity 0.7s ease,
      transform 0.4s cubic-bezier(0.41, 0, 0.12, 0.99)
        var(--lyrics-line-delay, 0s),
      filter 0s linear;
  }
  .lyrics-word:not(.allow-break) {
    vertical-align: baseline;
    white-space: nowrap;
    display: inline-block;
  }
  .lyrics-word.allow-break {
    display: inline;
  }
  .lyrics-line .lyrics-word .lyrics-syllable.has-chars {
    transform: none !important;
  }
  .lyrics-line .lyrics-word.normal-word-motion .lyrics-syllable.no-chars {
    transition-property: color, background-color, opacity !important;
  }
  .lyrics-line
    .lyrics-word.normal-word-motion:not(.allow-break)
    .lyrics-syllable.no-chars {
    transform: none !important;
  }
  .lyrics-word.normal-word-motion.word-started:not(.allow-break) {
    transform: translate3d(
      0,
      calc(var(--char-rise-y) * var(--am-lyrics-lift)),
      0
    );
  }
  .lyrics-line .lyrics-word .lyrics-syllable .char.native-motion {
    transform-origin: 50% 80%;
    transition-property: color, background-color !important;
  }
  .reduced-motion
    .lyrics-line
    .lyrics-word
    .lyrics-syllable
    .char.native-motion {
    transform: none !important;
  }
  .lyrics-word.char-rise,
  .lyrics-word.char-drag {
    vertical-align: baseline;
    white-space: nowrap;
    display: inline-block;
  }
  .lyrics-word.char-rise.allow-break,
  .lyrics-word.char-drag.allow-break {
    white-space: normal;
    display: inline;
  }
  .lyrics-syllable-wrap {
    display: inline;
  }
  .lyrics-syllable-wrap.has-transliteration {
    flex-direction: column;
    align-items: start;
    display: inline-flex;
  }
  .lyrics-syllable {
    vertical-align: baseline;
    padding-block: 0.12em;
    margin-block: -0.12em;
    color: #0000;
    background-color: var(--lyplus-text-secondary);
    white-space: pre-wrap;
    font-variant-ligatures: none;
    font-feature-settings: "liga" 0;
    -webkit-background-clip: text;
    background-clip: text;
    transition:
      color 0.7s,
      background-color 0.7s,
      transform 0.7s;
    display: inline-block;
  }
  .lyrics-syllable.finished {
    background-color: var(--lyplus-text-primary);
    transition:
      transform 1s,
      background-color 0.7s,
      color 0.7s;
  }
  .lyrics-syllable.finished.has-chars {
    background-color: #0000;
  }
  .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable {
    transition:
      transform 1s,
      background-color 0.5s,
      color 0.5s;
  }
  .lyrics-line .lyrics-word .lyrics-syllable.line-synced {
    transform: none !important;
  }
  .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.highlight.no-chars,
  .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.pre-highlight.no-chars {
    background-repeat: no-repeat;
    background-image: linear-gradient(
      90deg,
      var(--lyplus-text-primary, #fff) 0%,
      var(--lyplus-text-primary, #fff)
        calc(100% - var(--wipe-gradient-width, 0.75em)),
      #0000 100%
    );
    background-position: 0;
    background-size: 0% 100%;
  }
  .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.highlight.rtl-text,
  .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.pre-highlight.rtl-text {
    background-image: linear-gradient(
      -90deg,
      var(--lyplus-text-primary) 0%,
      var(--lyplus-text-primary) calc(100% - var(--wipe-gradient-width, 0.75em)),
      transparent 100%
    );
    direction: rtl;
    background-position: right 0%;
    background-size: 0% 100%;
  }
  .lyrics-line.active
    .background-vocal-container
    .lyrics-syllable.highlight.no-chars,
  .lyrics-line.active
    .background-vocal-container
    .lyrics-syllable.pre-highlight.no-chars,
  .lyrics-line.pre-active
    .background-vocal-container
    .lyrics-syllable.highlight.no-chars,
  .lyrics-line.pre-active
    .background-vocal-container
    .lyrics-syllable.pre-highlight.no-chars {
    background-image: linear-gradient(
      90deg,
      color-mix(in srgb, var(--lyplus-text-primary, #fff) 50%, #888) 0%,
      color-mix(in srgb, var(--lyplus-text-primary, #fff) 50%, #888)
        calc(100% - var(--wipe-gradient-width, 0.75em)),
      #0000 100%
    );
  }
  .lyrics-line.active
    .background-vocal-container
    .lyrics-syllable.highlight.rtl-text,
  .lyrics-line.active
    .background-vocal-container
    .lyrics-syllable.pre-highlight.rtl-text,
  .lyrics-line.pre-active
    .background-vocal-container
    .lyrics-syllable.highlight.rtl-text,
  .lyrics-line.pre-active
    .background-vocal-container
    .lyrics-syllable.pre-highlight.rtl-text {
    background-image: linear-gradient(
      -90deg,
      color-mix(in srgb, var(--lyplus-text-primary) 50%, #888) 0%,
      color-mix(in srgb, var(--lyplus-text-primary) 50%, #888)
        calc(100% - var(--wipe-gradient-width, 0.75em)),
      transparent 100%
    );
  }
  .lyrics-line:not(.lyrics-gap)
    .lyrics-word.word-started:not(.growable):not(.char-rise):not(.char-drag)
    .lyrics-syllable.no-chars,
  .lyrics-line.active:not(.lyrics-gap)
    .lyrics-word.word-started
    .lyrics-syllable.no-chars,
  .lyrics-line.persist-highlight:not(.lyrics-gap)
    .lyrics-word
    .lyrics-syllable.no-chars.finished,
  .lyrics-word.growable .lyrics-syllable.cleanup .char,
  .lyrics-word.char-drag .lyrics-syllable.cleanup .char,
  .lyrics-line.persist-highlight
    .lyrics-word.growable
    .lyrics-syllable.finished
    .char,
  .lyrics-line.persist-highlight
    .lyrics-word.char-drag
    .lyrics-syllable.finished
    .char {
    transform: translate3d(
      0,
      calc(var(--char-rise-y, -1.12px) * var(--am-lyrics-lift)),
      0
    );
  }
  .background-vocal-container .lyrics-syllable {
    background-color: color-mix(
      in srgb,
      var(--lyplus-text-secondary) 50%,
      #888
    );
  }
  .lyrics-line.active:not(.lyrics-gap)
    .background-vocal-container
    .lyrics-syllable.finished,
  .lyrics-line.pre-active
    .background-vocal-container
    .lyrics-syllable.finished {
    background-color: color-mix(in srgb, var(--lyplus-text-primary) 50%, #888);
  }
  .background-vocal-container .lyrics-syllable.line-synced {
    color: color-mix(
      in srgb,
      var(--lyplus-text-secondary) 50%,
      #888
    ) !important;
  }
  .lyrics-line.active:not(.lyrics-gap)
    .background-vocal-container
    .lyrics-syllable.line-synced,
  .lyrics-line.pre-active
    .background-vocal-container
    .lyrics-syllable.line-synced,
  .lyrics-line.active:not(.lyrics-gap)
    .background-vocal-container
    .lyrics-syllable.line-synced.finished,
  .lyrics-line.pre-active
    .background-vocal-container
    .lyrics-syllable.line-synced.finished {
    color: color-mix(in srgb, var(--lyplus-text-primary) 50%, #888) !important;
  }
  .lyrics-line.active:not(.lyrics-gap)
    .background-vocal-container
    .lyrics-word.word-started
    .lyrics-syllable.no-chars,
  .lyrics-line.persist-highlight:not(.lyrics-gap)
    .background-vocal-container
    .lyrics-word
    .lyrics-syllable.no-chars.finished {
    transform: translate3d(
      0,
      calc(var(--char-rise-y) * var(--am-lyrics-lift)),
      0
    );
  }
  .lyrics-line.active:not(.lyrics-gap)
    .lyrics-word.char-rise.word-started
    .lyrics-syllable.transliteration:not(.highlight):not(.finished) {
    transform: none;
  }
  .lyrics-syllable.pre-highlight {
    animation-name: pre-wipe-universal;
    animation-duration: var(--pre-wipe-duration);
    animation-delay: var(--pre-wipe-delay);
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
  .lyrics-syllable.pre-highlight.rtl-text {
    animation-name: pre-wipe-universal-rtl;
  }
  .lyrics-syllable.transliteration {
    font-size: var(--lyplus-font-size-subtext);
    white-space: pre-wrap;
    pointer-events: none;
    user-select: none;
  }
  .lyrics-line .lyrics-syllable.has-chars:not(.finished) {
    color: #0000;
    background-color: #0000;
  }
  .char-motion {
    vertical-align: baseline;
    transform-origin: 50% 80%;
    display: inline-block;
  }
  .lyrics-syllable .char-motion > .char,
  .reduced-motion .char-motion {
    transform: none !important;
  }
  .lyrics-syllable span.char {
    background-color: var(--lyplus-text-secondary);
    white-space: break-spaces;
    font-variant-ligatures: none;
    font-feature-settings: "liga" 0;
    -webkit-text-fill-color: transparent;
    transform-origin: 50% 80%;
    background-origin: padding-box;
    -webkit-background-clip: text;
    background-clip: text;
    margin-inline: -0.04em;
    padding-inline: 0.04em;
    padding-block: 0.12em;
    margin-block: -0.12em;
    transition:
      color 0.7s,
      background-color 0.7s,
      transform 0.7s;
    display: inline-block;
    position: relative;
  }
  .reduced-motion .char:after {
    display: none;
  }
  .lyrics-syllable.finished span.char {
    background-color: var(--lyplus-text-primary);
    transition:
      color 0.7s,
      background-color 0.7s,
      transform 0.7s;
  }
  .lyrics-word.char-drag span.char {
    transition: color 0.18s;
  }
  .lyrics-line.active .lyrics-syllable span.char {
    background-repeat: no-repeat;
    -webkit-background-clip: text;
    background-clip: text;
    background-image: linear-gradient(
      90deg,
      var(--lyplus-text-primary, #fff) 0%,
      var(--lyplus-text-primary, #fff)
        calc(100% - var(--wipe-gradient-width, 0.75em)),
      #0000 100%
    );
    background-size: calc(
        var(--word-wipe-width, 1ch) + var(--wipe-gradient-width, 0.75em)
      )
      100%;
    background-position: calc(
        var(--char-wipe-position, 0px) - var(--word-wipe-width, 1ch) - var(
            --wipe-gradient-width,
            0.75em
          )
      )
      0%;
    transition:
      transform 0.7s,
      color 0.18s;
  }
  .lyrics-line.active .lyrics-syllable span.char.highlight {
    background-image: linear-gradient(
      -90deg,
      var(--lyplus-text-primary, #fff) 0%,
      var(--lyplus-text-primary, #fff)
        calc(100% - var(--wipe-gradient-width, 0.75em)),
      #0000 100%
    );
    background-position: right 0%;
    background-size: 0% 100%;
  }
  .lyrics-line.active .lyrics-syllable span.char.pre-wipe-lead {
    animation-name: char-word-wipe;
    animation-duration: var(--pre-wipe-duration);
    animation-delay: var(--pre-wipe-delay);
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
  .lyrics-line .lyrics-word .lyrics-syllable.shared-word-wipe,
  .lyrics-line .lyrics-word .lyrics-syllable span.char.shared-word-wipe {
    color: var(--word-wipe-color, var(--lyplus-text-primary));
    -webkit-text-fill-color: transparent;
    background-repeat: no-repeat;
    background-size: calc(
        var(--word-wipe-width) + var(--wipe-gradient-width, 0.75em)
      )
      100%;
    transition:
      color,
      background-color 0.7s,
      transform 1s;
    background-image: linear-gradient(
      90deg,
      currentColor 0%,
      currentColor calc(100% - var(--wipe-gradient-width, 0.75em)),
      transparent 100%
    ) !important;
  }
  .lyrics-line .lyrics-word .lyrics-syllable.shared-word-wipe.word-wipe-rtl,
  .lyrics-line
    .lyrics-word
    .lyrics-syllable
    span.char.shared-word-wipe.word-wipe-rtl {
    background-image: linear-gradient(
      -90deg,
      currentColor 0%,
      currentColor calc(100% - var(--wipe-gradient-width, 0.75em)),
      transparent 100%
    ) !important;
  }
  .lyrics-container:not(.is-unsynced)
    .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap),
  .lyrics-container:not(.is-unsynced) .lyrics-line.scroll-exiting {
    transition:
      opacity var(--scroll-duration, 0.35s) ease-out,
      transform 0.4s cubic-bezier(0.41, 0, 0.12, 0.99)
        var(--lyrics-line-delay, 0s),
      filter var(--scroll-duration, 0.35s) ease-out;
  }
  .lyrics-container:not(.is-unsynced)
    .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap)
    .lyrics-syllable,
  .lyrics-container:not(.is-unsynced)
    .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap)
    .lyrics-syllable
    span.char,
  .lyrics-container:not(.is-unsynced)
    .lyrics-line.scroll-exiting
    .lyrics-syllable,
  .lyrics-container:not(.is-unsynced)
    .lyrics-line.scroll-exiting
    .lyrics-syllable
    span.char {
    transition:
      color var(--scroll-duration, 0.35s) ease-out,
      background-color var(--scroll-duration, 0.35s) ease-out,
      opacity var(--scroll-duration, 0.35s) ease-out,
      transform 0.7s ease;
  }
  .lyrics-container:not(.is-unsynced)
    .lyrics-line.scroll-exiting
    .lyrics-syllable.no-chars:not(.line-synced),
  .lyrics-container:not(.is-unsynced)
    .lyrics-line.scroll-exiting
    .lyrics-syllable
    span.char {
    color: #0000 !important;
    background-color: var(
      --word-inactive-color,
      var(--lyplus-text-secondary)
    ) !important;
  }
  .lyrics-line.scroll-exiting .char:after {
    opacity: 0 !important;
  }
  .lyrics-container:not(.is-unsynced)
    .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap)
    .lyrics-syllable.no-chars:not(.line-synced),
  .lyrics-container:not(.is-unsynced)
    .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap)
    .lyrics-syllable
    span.char {
    background-image: none !important;
    background-color: var(
      --word-inactive-color,
      var(--lyplus-text-secondary)
    ) !important;
  }
  .lyrics-gap {
    --gap-scale: 0;
    --gap-opacity: 0;
    height: 0;
    padding: 0 var(--lyplus-padding-line);
    opacity: 1;
    box-sizing: border-box;
    background-clip: unset;
    transform-origin: top;
    transition: transform var(--scroll-duration, 0.28s);
    align-items: center;
    margin-block-end: 0;
    display: flex;
    overflow: visible;
    content-visibility: visible !important;
    contain: none !important;
  }
  .lyrics-gap.active {
    height: calc(
      var(--am-lyrics-instrumental-height) +
        var(--am-lyrics-instrumental-spacing)
    );
    transition: transform var(--scroll-duration, 0.28s);
  }
  .lyrics-gap.gap-collapsing {
    height: 0;
    transition: transform var(--scroll-duration, 0.28s);
  }
  .lyrics-gap .main-vocal-container {
    height: calc(
      var(--am-lyrics-instrumental-height) +
        var(--am-lyrics-instrumental-spacing) + var(--am-lyrics-line-spacing)
    );
    opacity: 0;
    transform-origin: 50%;
    transition:
      opacity var(--scroll-duration, 0.4s) cubic-bezier(0.4, 0, 0.6, 1),
      transform var(--scroll-duration, 0.4s) cubic-bezier(0.2, 0, 0.2, 1);
    will-change: transform, opacity;
    align-items: center;
    margin: 0;
    line-height: 1;
    display: flex;
    position: absolute;
    inset-block-start: calc(0px - var(--am-lyrics-line-spacing));
    inset-inline-start: var(--lyplus-padding-line);
    transform: scale(0);
  }
  .lyrics-gap.active .main-vocal-container {
    opacity: var(--gap-opacity);
    transform: scale(var(--gap-scale));
    transition: none;
  }
  .lyrics-gap.gap-collapsing .main-vocal-container,
  .lyrics-gap.gap-exiting .main-vocal-container {
    height: calc(
      var(--am-lyrics-instrumental-height) +
        var(--am-lyrics-instrumental-spacing) + var(--am-lyrics-line-spacing)
    );
  }
  .lyrics-gap.gap-exiting .main-vocal-container {
    opacity: var(--gap-exit-opacity, 0);
    transform: scale(
      var(--gap-exit-scale, var(--am-lyrics-instrumental-exit-scale))
    );
    transition: none;
  }
  .lyrics-gap .lyrics-word,
  .lyrics-gap .lyrics-syllable-wrap {
    align-items: center;
    height: 100%;
    display: flex;
  }
  .lyrics-gap .lyrics-syllable {
    width: var(--lyplus-gap-dot-size);
    height: var(--lyplus-gap-dot-size);
    background-color: var(--lyplus-text-primary);
    margin: 0 var(--lyplus-gap-dot-margin);
    border-radius: 50%;
    display: inline-block;
  }
  .lyrics-syllable.line-synced {
    opacity: 0.55;
    color: var(--lyplus-lyrics-palette) !important;
    background: 0 0 !important;
    transition: color 0.32s ease-out, opacity 0.32s ease-out !important;
  }
  .lyrics-line:is(.active, .pre-active) .lyrics-syllable.line-synced {
    opacity: 1;
    color: var(--lyplus-text-primary) !important;
    animation: none !important;
    transition-duration: 0.12s !important;
  }
  .lyrics-line:is(.active, .pre-active) .lyrics-syllable.line-synced span.char {
    background-image: none !important;
    background-color: var(--lyplus-text-primary) !important;
    transition: background-color 0.12s ease-out !important;
  }
  .lyrics-gap .lyrics-syllable {
    background-color: var(--lyplus-text-primary);
    background-clip: unset;
    opacity: var(--gap-dot-opacity, 0.25);
  }
  .lyrics-gap.active .lyrics-syllable.finished,
  .lyrics-gap.gap-exiting .lyrics-syllable.finished,
  .lyrics-gap:not(.active):not(.gap-exiting).post-active-line .lyrics-syllable,
  .lyrics-gap:not(.active):not(.gap-exiting).lyrics-activest .lyrics-syllable {
    background-color: var(--lyplus-text-primary);
    animation: none !important;
  }
  .lyrics-plus-metadata {
    box-sizing: border-box;
    transform: translateY(var(--lyrics-scroll-offset, 0px));
    transition:
      opacity 0.3s ease,
      transform 0.6s cubic-bezier(0.23, 1, 0.32, 1) var(--lyrics-line-delay, 0s),
      filter 0.3s ease;
    font-weight: 400;
    display: block;
    position: relative;
  }
  .lyrics-plus-empty {
    height: 100vh;
    transform: translateY(var(--lyrics-scroll-offset, 0px));
    display: block;
  }
  .lyrics-footer {
    text-align: left;
    font-size: calc(var(--lyplus-font-size-base) * 0.5);
    color: var(--lyplus-text-secondary);
    opacity: 0.8;
    transform-origin: 0;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    margin-top: 10px;
    padding: 20px 0 50vh;
    font-weight: 400;
    transition:
      opacity 0.3s,
      transform 0.5s cubic-bezier(0.41, 0, 0.12, 0.99),
      filter 0.3s;
    display: flex;
  }
  .lyrics-footer.lyrics-line {
    font-size: calc(var(--lyplus-font-size-base) * 0.5);
    padding: 20px var(--lyplus-padding-line) 50vh var(--lyplus-padding-line);
    margin-top: 0;
    margin-block-end: 0;
  }
  .lyrics-footer.active {
    opacity: 1;
    color: #ffffff80;
  }
  .lyrics-container.blur-inactive-enabled:not(.not-focused)
    .lyrics-footer:not(.active) {
    filter: blur(var(--lyplus-blur-amount));
    opacity: 0.5;
  }
  .lyrics-container.user-scrolling .lyrics-footer {
    filter: none !important;
    opacity: 0.8 !important;
    transition: none !important;
  }
  .lyrics-footer p {
    margin: 5px 0;
  }
  .lyrics-footer a {
    color: var(--lyplus-text-primary);
    text-underline-offset: 2px;
    opacity: 0.8;
    transition: opacity 0.2s;
  }
  .lyrics-footer a:hover {
    opacity: 1;
  }
  .footer-content {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    display: flex;
  }
  .footer-controls {
    align-items: center;
    display: flex;
  }
  .source-switch-btn:focus-visible {
    outline: 2px solid
      color-mix(in srgb, var(--lyplus-text-primary) 72%, transparent);
    outline-offset: 2px;
  }
  .source-switch-btn {
    box-sizing: border-box;
    color: #aaa;
    cursor: pointer;
    white-space: nowrap;
    background: #ffffff0f;
    border: 0;
    border-radius: 6px;
    flex: none;
    justify-content: center;
    align-items: center;
    height: 26px;
    padding: 0 8px;
    font-family: inherit;
    font-size: 11px;
    line-height: 1;
    transition:
      color 0.2s,
      border-color 0.2s,
      background-color 0.2s,
      transform 0.12s;
    display: inline-flex;
    position: relative;
  }
  .source-switch-btn:active:not(:disabled) {
    transform: scale(0.96);
  }
  .source-switch-btn:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .source-switch-svg {
    flex: 0 0 12px;
    width: 12px;
    height: 12px;
    margin-right: 4px;
  }
  .source-switch-svg.is-loading {
    animation: 1s linear infinite source-switch-spin;
  }
  .control-button {
    color: #fff9;
    cursor: pointer;
    background: 0 0;
    border: 1px solid #ffffff4d;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 0.8em;
    font-weight: 400;
    transition:
      color 0.2s,
      border-color 0.2s,
      background-color 0.2s;
  }
  .control-button:hover {
    color: #ffffffe6;
    border-color: #ffffff80;
  }
  .control-button.active {
    background-color: var(--lyplus-text-primary);
    border-color: var(--lyplus-text-primary);
    color: #000;
  }
  .lyrics-translation-container,
  .lyrics-romanization-container {
    opacity: 0.8;
    font-size: var(--lyplus-font-size-subtext);
    overflow-wrap: break-word;
    pointer-events: none;
    user-select: none;
    padding-top: 0.2em;
    font-weight: 400;
    transition:
      opacity 0.3s,
      color 0.3s;
  }
  .lyrics-romanization-container {
    direction: ltr !important;
  }
  .lyrics-romanization-container.rtl-text {
    text-align: right;
    direction: rtl !important;
  }
  .lyrics-romanization-container .lyrics-syllable {
    white-space: pre-wrap;
  }
  .lyrics-translation-container {
    opacity: 0.5;
  }
  .main-line-wrapper.small {
    opacity: 0.8;
    margin-bottom: 0;
    font-size: 0.5em;
    display: block;
  }
  .translation-line {
    margin-top: 0;
    font-size: 1em;
    font-weight: 700;
    line-height: 1.1;
    display: block;
  }
  .romanized-line {
    color: #ffffff80;
    margin-top: 2px;
    font-size: 0.5em;
    font-weight: 400;
    display: block;
  }
  @keyframes skeleton-loading {
    0% {
      background-color: #ffffff1a;
    }
    to {
      background-color: #fff3;
    }
  }
  .skeleton-line {
    height: 2.5em;
    margin: 0 0 var(--am-lyrics-line-spacing);
    opacity: 0.7;
    border-radius: 16px;
    width: 60%;
    animation: 1s linear infinite alternate skeleton-loading;
  }
  .skeleton-line:nth-child(2n) {
    width: 80%;
  }
  .skeleton-line:nth-child(3n) {
    width: 50%;
  }
  .skeleton-line:nth-child(5n) {
    width: 70%;
  }
  .no-lyrics {
    color: #ffffff80;
    text-align: center;
    padding: 2em;
    font-size: 1.2em;
    font-weight: 400;
  }
  @keyframes source-switch-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes wipe {
    0% {
      background-position: 0;
      background-size: 0% 100%;
    }
    to {
      background-size: calc(100% + var(--wipe-gradient-width, 0.75em)) 100%;
      background-position: 0;
    }
  }
  @keyframes wipe-from-pre {
    0% {
      background-size: var(--wipe-gradient-width, 0.75em) 100%;
      background-position: 0;
    }
    to {
      background-size: calc(100% + var(--wipe-gradient-width, 0.75em)) 100%;
      background-position: 0;
    }
  }
  @keyframes start-wipe {
    0% {
      background-position: 0;
      background-size: 0% 100%;
    }
    to {
      background-size: calc(100% + var(--wipe-gradient-width, 0.75em)) 100%;
      background-position: 0;
    }
  }
  @keyframes wipe-rtl {
    0% {
      background-position: right 0%;
      background-size: 0% 100%;
    }
    to {
      background-size: calc(100% + var(--wipe-gradient-width, 0.75em)) 100%;
      background-position: right 0%;
    }
  }
  @keyframes wipe-from-pre-rtl {
    0% {
      background-size: var(--wipe-gradient-width, 0.75em) 100%;
      background-position: right 0%;
    }
    to {
      background-size: calc(100% + var(--wipe-gradient-width, 0.75em)) 100%;
      background-position: right 0%;
    }
  }
  @keyframes start-wipe-rtl {
    0% {
      background-position: right 0%;
      background-size: 0% 100%;
    }
    to {
      background-size: calc(100% + var(--wipe-gradient-width, 0.75em)) 100%;
      background-position: right 0%;
    }
  }
  @keyframes pre-wipe-universal {
    0% {
      background-position: 0;
      background-size: 0% 100%;
    }
    to {
      background-size: var(--wipe-gradient-width, 0.75em) 100%;
      background-position: 0;
    }
  }
  @keyframes pre-wipe-universal-rtl {
    0% {
      background-position: right 0%;
      background-size: 0% 100%;
    }
    to {
      background-size: var(--wipe-gradient-width, 0.75em) 100%;
      background-position: right 0%;
    }
  }
  @keyframes char-word-wipe {
    0% {
      background-position: calc(
          var(--char-wipe-position, 0px) - var(--word-wipe-width, 1ch) - var(
              --wipe-gradient-width,
              0.75em
            )
        )
        0%;
    }
    to {
      background-position: var(--char-wipe-position, 0px) 0%;
    }
  }
  @keyframes fade-gap {
    0% {
      background-color: var(--lyplus-text-secondary);
    }
    to {
      background-color: var(--lyplus-text-primary);
    }
  }
  @keyframes grow-static {
    0%,
    to {
      transform: scale3d(1.01, 1.01, 1.1) ;
    }
    30%,
    40% {
      transform: scale3d(1.1, 1.1, 1.1) ;
    }
  }
  @keyframes fadeInUp {
    0% {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 0.7;
      transform: translateY(0);
    }
  }
  .opposite-turn {
    text-align: right;
  }
  .singer-right {
    text-align: right;
    justify-content: flex-end;
  }
  .singer-left {
    text-align: left;
    justify-content: flex-start;
  }
  .progress-text {
    background: linear-gradient(
      to right,
      var(--lyplus-text-primary) 0%,
      var(--lyplus-text-primary) var(--line-progress, 0%),
      var(--lyplus-text-secondary) var(--line-progress, 0%),
      var(--lyplus-text-secondary) 100%
    );
    -webkit-text-fill-color: transparent;
    color: var(--lyplus-text-secondary);
    -webkit-background-clip: text;
    background-clip: text;
    display: inline-block;
    position: relative;
    transform: translate(0, 0);
  }
  .progress-text:before {
    display: none;
  }
  .active-line {
    font-weight: 700;
  }
  .background-text {
    color: var(--lyplus-text-secondary);
    flex-shrink: 0;
    margin: 0;
    font-size: 0.8em;
    font-style: normal;
    line-height: 1.1;
    display: block;
  }
  .background-text.before {
    order: -1;
  }
  .background-text.after {
    order: 1;
  }
  .instrumental-line {
    color: var(--lyplus-text-secondary);
    align-items: baseline;
    gap: 8px;
    padding: 4px 10px;
    font-size: 0.9em;
    font-weight: 400;
    animation: 0.22s fadeInUp;
    display: inline-flex;
  }
  .instrumental-duration {
    color: var(--lyplus-text-secondary);
    font-size: 0.8em;
  }
  @container (width<=519px) {
    .lyrics-container {
      --lyplus-font-size-base: var(--am-lyrics-compact-font-size, 28px);
      --am-lyrics-line-spacing: var(--am-lyrics-compact-line-spacing, 20px);
      --am-lyrics-background-vocal-font-size: var(
        --am-lyrics-compact-background-vocal-font-size,
        0.857em
      );
      --lyrics-scroll-padding-top: var(
        --am-lyrics-compact-selected-position,
        50%
      );
      --am-lyrics-inline-padding: 14px;
    }
  }
  @container (width>=900px) {
    .lyrics-container {
      --lyplus-font-size-base: var(--am-lyrics-wide-font-size, 48px);
      --am-lyrics-line-height: 1.17;
      --am-lyrics-line-spacing: var(--am-lyrics-wide-line-spacing, 32px);
      --am-lyrics-background-vocal-font-size: var(
        --am-lyrics-wide-background-vocal-font-size,
        0.667em
      );
      --lyrics-scroll-padding-top: var(--am-lyrics-wide-selected-position, 50%);
      --am-lyrics-inline-padding: 32px;
    }
  }
  @media (prefers-contrast: more) {
    :host {
      --lyplus-text-secondary: color-mix(
        in srgb,
        var(--lyplus-lyrics-palette),
        transparent 24%
      );
    }
    .lyrics-line:focus-visible:before {
      box-shadow: 0 0 0 3px var(--lyplus-text-primary);
    }
  }
  :host([no-blur]) .lyrics-line {
    filter: none !important;
    transition-property: opacity, transform !important;
  }
  :host([hide-played-lines])
    .lyrics-container:not(.user-scrolling):not(.touch-scrolling)
    .lyrics-line.played:not(:focus-within) {
    opacity: 0;
    pointer-events: none;
  }
  .lyrics-container.reduced-motion .lyrics-line,
  .lyrics-container.reduced-motion .lyrics-line:before,
  .lyrics-container.reduced-motion .lyrics-line-container,
  .lyrics-container.reduced-motion .main-vocal-container,
  .lyrics-container.reduced-motion .background-vocal-container,
  .lyrics-container.reduced-motion .background-vocal-wrap,
  .lyrics-container.reduced-motion .lyrics-plus-metadata,
  .lyrics-container.reduced-motion .lyrics-footer {
    transition: none !important;
    animation: none !important;
  }
  .lyrics-container.reduced-motion .lyrics-line,
  .lyrics-container.reduced-motion .lyrics-line-container,
  .lyrics-container.reduced-motion .main-vocal-container,
  .lyrics-container.reduced-motion .background-vocal-wrap,
  .lyrics-container.reduced-motion .lyrics-syllable,
  .lyrics-container.reduced-motion .lyrics-word.normal-word-motion,
  .lyrics-container.reduced-motion .lyrics-syllable span.char {
    transform: none !important;
  }
  .lyrics-container.reduced-motion .lyrics-syllable span.char {
    filter: none !important;
    transition: none !important;
  }
`;
