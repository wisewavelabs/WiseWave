import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Track } from "../../../mygo";
import { Artwork, hasArtworkURL } from "../../../shared/ui/Artwork";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { PlayingSpectrum } from "../../../shared/ui/PlayingSpectrum";

const SPRING_OMEGA = Math.sqrt(400);
const FLING_VELOCITY = 300;
const AUTO_MS = 5000;
const HEIGHT = 340;
const ITEM_SPACING = 8;
const MIN_SMALL = 40;
const MAX_SMALL = 56;
const CORNER_RADIUS = 24;

type Keyline = { size: number; offset: number; un: number };
type Strategy = {
  S: number;
  L: number;
  u: number;
  mid: Keyline[];
  start: Keyline[];
  end: Keyline[];
  maxScroll: number;
  shift: number;
  centered: boolean;
  snaps: number[];
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const kl = (size: number, offset: number, un: number): Keyline => ({ size, offset, un });

function buildStrategy(W: number, n: number, preferred?: number): Strategy | null {
  if (!W || !n) return null;
  const S = preferred ? clamp((W - 2 * ITEM_SPACING - preferred) / 2, MIN_SMALL, MAX_SMALL) : MIN_SMALL;
  const L = W - 2 * S - 2 * ITEM_SPACING;
  if (L <= S) return null;
  const u = L + ITEM_SPACING;
  const F = S + ITEM_SPACING + L / 2;
  const mid = [
    kl(0, 0, F - 2 * u), kl(S, S / 2, F - u), kl(L, F, F),
    kl(S, W - S / 2, F + u), kl(0, W, F + 2 * u),
  ];
  const start = [
    kl(0, 0, L / 2 - u), kl(L, L / 2, L / 2), kl(S, L + ITEM_SPACING + S / 2, L / 2 + u),
    kl(S, W - S / 2, L / 2 + 2 * u), kl(0, W, L / 2 + 3 * u),
  ];
  const Fe = W - L / 2;
  const end = [
    kl(0, 0, Fe - 3 * u), kl(S, S / 2, Fe - 2 * u), kl(S, S + ITEM_SPACING + S / 2, Fe - u),
    kl(L, Fe, Fe), kl(0, W, Fe + u),
  ];
  const maxScroll = Math.max(0, n * L + (n - 1) * ITEM_SPACING - W);
  const centered = n >= 3;
  const snaps = Array.from({ length: n }, (_, i) =>
    !centered ? Math.min(i * u, maxScroll)
      : i === 0 ? 0
        : i === n - 1 ? maxScroll
          : i * u + L / 2 - W / 2,
  );
  return { S, L, u, mid, start, end, maxScroll, shift: L - S, centered, snaps };
}

const lerpList = (a: Keyline[], b: Keyline[], t: number) =>
  a.map((k, i) => kl(lerp(k.size, b[i].size, t), lerp(k.offset, b[i].offset, t), lerp(k.un, b[i].un, t)));

function keylinesAt(st: Strategy, s: number) {
  if (!st.centered) return st.start;
  if (s < st.shift) return lerpList(st.start, st.mid, s / st.shift);
  if (s > st.maxScroll - st.shift) return lerpList(st.end, st.mid, (st.maxScroll - s) / st.shift);
  return st.mid;
}

function shapeAt(list: Keyline[], c: number) {
  const first = list[0];
  const last = list[list.length - 1];
  if (c <= first.un) return first;
  if (c >= last.un) return last;
  let i = 0;
  while (list[i + 1].un <= c) i++;
  const a = list[i];
  const b = list[i + 1];
  const t = (c - a.un) / (b.un - a.un);
  return { size: lerp(a.size, b.size, t), offset: lerp(a.offset, b.offset, t) };
}

const nearestSnap = (snaps: number[], s: number) => {
  let best = 0;
  let bd = Infinity;
  snaps.forEach((p, i) => {
    const d = Math.abs(p - s);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
};

export function HomeHeroCarousel({
  tracks,
  onPlay,
  current = null,
  playing = false,
}: {
  tracks: Track[];
  onPlay: (track: Track, queue: Track[]) => void;
  current?: Track | null;
  playing?: boolean;
}) {
  const items = useMemo(
    () => tracks.filter((track) => track?.id && hasArtworkURL(track.album_art_url)).slice(0, 24),
    [tracks],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const offsetRef = useRef(0);
  const pageRef = useRef(2);
  const targetRef = useRef(2);
  const anim = useRef(0);
  const widthRef = useRef(0);
  const strategyRef = useRef<Strategy | null>(null);
  const drag = useRef({ moved: false, axis: "" as "" | "x" | "y", x: 0, y: 0, s: 0, page: 0, samples: [] as [number, number][] });
  const autoPauseUntil = useRef(0);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(2);
  const slides = useMemo(() => items.length > 1 ? [...items.slice(-2), ...items, ...items.slice(0, 2)] : items, [items]);
  const n = slides.length;
  const loop = items.length > 1;
  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const readWidth = useCallback((el: HTMLElement) => {
    const layout = el.offsetWidth || el.clientWidth;
    if (layout > 0) return layout;
    const parent = el.parentElement;
    if (parent) {
      const parentWidth = parent.clientWidth || parent.offsetWidth;
      if (parentWidth > 0) return parentWidth;
    }
    return 0;
  }, []);

  const commitWidth = useCallback((next: number) => {
    const value = Math.round(next);
    if (value < 160) return;
    if (value === widthRef.current) return;
    widthRef.current = value;
    setWidth(value);
  }, []);

  const measure = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    commitWidth(readWidth(el));
  }, [commitWidth, readWidth]);

  const built = useMemo(() => buildStrategy(width, n), [width, n]);
  if (built) strategyRef.current = built;
  const cached = strategyRef.current;
  const st = built ?? (cached && cached.snaps.length === n ? cached : null);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    measure();
    let frames = 0;
    let raf = 0;
    const retry = () => {
      measure();
      frames += 1;
      if (widthRef.current < 160 && frames < 60) raf = requestAnimationFrame(retry);
    };
    raf = requestAnimationFrame(retry);

    const ro = new ResizeObserver(() => {
      commitWidth(readWidth(el));
    });
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cancelAnimationFrame(anim.current);
    };
  }, [commitWidth, measure, readWidth, n]);

  useEffect(() => {
    const onRemeasure = () => {
      requestAnimationFrame(() => {
        measure();
        requestAnimationFrame(measure);
      });
    };
    window.addEventListener("resize", onRemeasure);
    window.addEventListener("focus", onRemeasure);
    document.addEventListener("visibilitychange", onRemeasure);
    window.addEventListener("wisewave-settings-updated", onRemeasure);
    window.addEventListener("wisewave-settings-changed", onRemeasure);
    const root = document.documentElement;
    const mo = new MutationObserver(onRemeasure);
    mo.observe(root, { attributes: true, attributeFilter: ["data-ui", "style"] });
    const app = document.querySelector(".app-content");
    const appMo = app ? new MutationObserver(onRemeasure) : null;
    if (app && appMo) appMo.observe(app, { attributes: true, attributeFilter: ["class"] });
    return () => {
      window.removeEventListener("resize", onRemeasure);
      window.removeEventListener("focus", onRemeasure);
      document.removeEventListener("visibilitychange", onRemeasure);
      window.removeEventListener("wisewave-settings-updated", onRemeasure);
      window.removeEventListener("wisewave-settings-changed", onRemeasure);
      mo.disconnect();
      appMo?.disconnect();
    };
  }, [measure]);

  const applyOffset = useCallback((raw: number) => {
    if (!st) return;
    offsetRef.current = raw;
    const s = clamp(raw, 0, st.maxScroll);
    const over = raw - s;
    const list = keylinesAt(st, s);
    const nextPage = nearestSnap(st.snaps, s);
    const dragging = drag.current.moved;
    const root = rootRef.current;
    if (root && !dragging) root.style.cursor = "grab";

    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      el.style.cursor = i === nextPage && !dragging ? "pointer" : "inherit";
      const c = i * st.u + st.L / 2 - s;
      const { size, offset } = shapeAt(list, c);
      el.style.transform = `translate3d(${offset - st.L / 2}px,0,0)`;
      el.style.clipPath = `inset(0 ${(st.L - size) / 2}px round ${CORNER_RADIUS}px)`;
      el.style.visibility = size < 0.5 ? "hidden" : "visible";
      const t = clamp((size / st.L - 0.4) / 0.6);
      const smooth = (x: number) => x * x * (3 - 2 * x);
      el.style.setProperty("--focus", String(smooth(t)));
    });

    const layer = layerRef.current;
    if (layer) {
      layer.style.transformOrigin = over < 0 ? "left center" : "right center";
      layer.style.transform = over ? `scaleX(${1 + clamp(Math.abs(over) / st.L) * 0.2})` : "";
    }

    if (nextPage !== pageRef.current) {
      pageRef.current = nextPage;
      setPage(nextPage);
    }
  }, [st]);

  useLayoutEffect(() => {
    if (!st) return;
    cancelAnimationFrame(anim.current);
    const p = loop ? clamp(pageRef.current, 2, n - 3) : 0;
    targetRef.current = p;
    pageRef.current = p;
    setPage(p);
    applyOffset(st.snaps[p] ?? 0);
  }, [st, n, loop, applyOffset]);

  const animateTo = useCallback((target: number, v0 = 0, complete?: () => void) => {
    cancelAnimationFrame(anim.current);
    if (reduceMotion) {
      applyOffset(target);
      complete?.();
      return;
    }
    const x0 = offsetRef.current;
    const A = x0 - target;
    const B = v0 + SPRING_OMEGA * A;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const e = Math.exp(-SPRING_OMEGA * t);
      const x = target + (A + B * t) * e;
      const v = (B - SPRING_OMEGA * (A + B * t)) * e;
      if ((Math.abs(x - target) < 0.3 && Math.abs(v) < 5) || t > 2) {
        applyOffset(target);
        complete?.();
        return;
      }
      applyOffset(x);
      anim.current = requestAnimationFrame(tick);
    };
    anim.current = requestAnimationFrame(tick);
  }, [applyOffset, reduceMotion]);

  const goTo = useCallback((i: number, v0 = 0) => {
    if (!st || !n) return;
    const p = clamp(i, 0, n - 1);
    targetRef.current = p;
    animateTo(st.snaps[p], v0, () => {
      if (!loop || (p !== 1 && p !== n - 2)) return;
      const equivalent = p === 1 ? n - 3 : 2;
      targetRef.current = equivalent;
      applyOffset(st.snaps[equivalent]);
    });
  }, [st, n, loop, animateTo, applyOffset]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !st) return;

    const hitItem = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const item = target.closest(".home-hero-item");
      return item && el.contains(item) ? item : null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const item = hitItem(e.target);
      if (!item) return;

      cancelAnimationFrame(anim.current);
      autoPauseUntil.current = performance.now() + AUTO_MS;
      const d = drag.current;
      d.moved = false;
      d.axis = "";
      d.x = e.clientX;
      d.y = e.clientY;
      d.s = offsetRef.current;
      d.page = nearestSnap(st.snaps, clamp(offsetRef.current, 0, st.maxScroll));
      d.samples = [[performance.now(), offsetRef.current]];

      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - d.x;
        const dy = ev.clientY - d.y;
        if (!d.axis) {
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
          d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
          if (d.axis === "x") {
            d.moved = true;
            el.style.cursor = "grabbing";
            itemRefs.current.forEach((node) => {
              if (node) node.style.cursor = "inherit";
            });
          }
        }
        if (d.axis !== "x") return;
        ev.preventDefault();
        let raw = d.s - dx;
        if (raw < 0) raw *= 0.5;
        else if (raw > st.maxScroll) raw = st.maxScroll + (raw - st.maxScroll) * 0.5;
        applyOffset(raw);
        const now = performance.now();
        d.samples.push([now, raw]);
        d.samples = d.samples.filter(([t]) => now - t < 100);
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        el.style.cursor = "grab";
        const wasSlide = d.moved && d.axis === "x";
        if (!wasSlide) {
          d.moved = false;
          d.axis = "";
          return;
        }
        const now = performance.now();
        const recent = d.samples.filter(([t]) => now - t < 100);
        let v = 0;
        if (recent.length > 1) {
          const [t1, s1] = recent[0];
          const [t2, s2] = recent[recent.length - 1];
          v = t2 > t1 ? ((s2 - s1) / (t2 - t1)) * 1000 : 0;
        }
        const near = nearestSnap(st.snaps, clamp(offsetRef.current, 0, st.maxScroll));
        let target = Math.abs(v) > FLING_VELOCITY ? d.page + (v > 0 ? 1 : -1) : near;
        target = clamp(target, d.page - 1, d.page + 1);
        goTo(target, v);
        window.setTimeout(() => {
          d.moved = false;
          d.axis = "";
          applyOffset(offsetRef.current);
        }, 0);
      };

      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };

    el.addEventListener("pointerdown", onPointerDown);
    return () => el.removeEventListener("pointerdown", onPointerDown);
  }, [st, applyOffset, goTo]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !st) return;
    let lock = 0;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      const next = targetRef.current + (e.deltaX > 0 ? 1 : -1);
      if (next < 0 || next > n - 1) return;
      e.preventDefault();
      const now = performance.now();
      if (now < lock) return;
      lock = now + 450;
      autoPauseUntil.current = now + AUTO_MS;
      goTo(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [st, n, goTo]);

  useEffect(() => {
    if (reduceMotion || n < 2) return;
    const timer = window.setInterval(() => {
      if (performance.now() < autoPauseUntil.current || drag.current.moved) return;
      goTo(targetRef.current + 1);
    }, AUTO_MS);
    return () => window.clearInterval(timer);
  }, [n, reduceMotion, goTo]);

  if (!items.length) return null;

  return (
    <section className="home-hero" aria-label="Featured songs">
      <div
        ref={rootRef}
        className="home-hero-viewport"
        role="region"
        aria-roledescription="carousel"
        tabIndex={0}
        style={{ height: HEIGHT }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            autoPauseUntil.current = performance.now() + AUTO_MS;
            goTo(targetRef.current + 1);
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            autoPauseUntil.current = performance.now() + AUTO_MS;
            goTo(targetRef.current - 1);
          }
        }}
      >
        {st ? (
          <div ref={layerRef} className="home-hero-layer">
            {slides.map((track, i) => {
              const active = i === page;
              const logicalIndex = loop ? (i - 2 + items.length) % items.length : i;
              return (
                <div
                  key={`${track.id}-${i}`}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  className={`home-hero-item${active ? " is-active" : ""}`}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${logicalIndex + 1} of ${items.length}: ${track.title}`}
                  style={{
                    width: st.L,
                    ["--focus" as string]: active ? "1" : "0",
                  }}
                  onClick={() => {
                    if (drag.current.moved) return;
                    autoPauseUntil.current = performance.now() + AUTO_MS;
                    if (i === pageRef.current) onPlay(track, items);
                    else goTo(i);
                  }}
                >
                  {Math.abs(i - page) <= 2 && <Artwork className="home-hero-art" src={track.album_art_url} size={640} />}
                  <span className="home-hero-scrim" aria-hidden="true" />
                  <span className={`home-hero-copy${active ? " is-visible" : ""}`}>
                    <MarqueeText className="home-hero-title">{track.title}</MarqueeText>
                    <span className="home-hero-artist">{track.artist}</span>
                  </span>
                  <PlayingSpectrum
                    active={active && current?.id === track.id}
                    playing={playing}
                    size={32}
                    placement="corner"
                    className="home-hero-spectrum"
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="home-hero-skeleton" aria-hidden="true" />
        )}
      </div>
    </section>
  );
}
