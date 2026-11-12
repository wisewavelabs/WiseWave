import { useEffect, useRef, useState, type ReactNode } from "react";
import { Music2, UserRound } from "lucide-react";

const loadedUrls = new Set<string>();
const failedUrls = new Set<string>();
const failedSources = new Set<string>();
const MAX_ATTEMPTS = 2;

function markLoaded(url: string) {
  failedUrls.delete(url);
  if (loadedUrls.size >= 1000) loadedUrls.delete(loadedUrls.keys().next().value!);
  loadedUrls.add(url);
}

function markFailed(url: string, src?: string) {
  loadedUrls.delete(url);
  if (failedUrls.size >= 1000) failedUrls.delete(failedUrls.keys().next().value!);
  failedUrls.add(url);
  if (src) {
    if (failedSources.size >= 1000) failedSources.delete(failedSources.keys().next().value!);
    failedSources.add(src);
  }
  window.dispatchEvent(new CustomEvent("wisewave-artwork-failed", { detail: { url, src } }));
}

function isYtimg(hostname: string) {
  return /(^|\.)ytimg\.com$/i.test(hostname);
}

function isAcceptableCover(width: number, height: number, allowWide = false) {
  if (width < 48 || height < 48) return false;
  if (allowWide) return true;
  const ratio = width / height;
  return ratio >= 0.88 && ratio <= 1.14;
}

export function artworkURL(src: string, size = 512) {
  try {
    const url = new URL(src);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.hostname === "c.saavncdn.com") {
      url.pathname = url.pathname.replace(/(?:50|150)x(?:50|150)/g, "500x500");
      return url.href;
    }
    if (url.hostname.endsWith("mzstatic.com")) {
      url.pathname = url.pathname.replace(/\/(?:\{w\}x\{h\}|\d+x\d+)(?:bb|cw)(?:-\d+)?\.(?:jpe?g|png|webp)$/i, `/${size}x${size}bb.jpg`);
      return url.href;
    }
    if (url.hostname.endsWith(".googleusercontent.com") || url.hostname.endsWith(".ggpht.com")) {
      const sized = `=w${size}-h${size}-l90-rj`;
      if (/=(?:w\d+-h\d+|s\d+)/.test(url.pathname)) {
        url.pathname = url.pathname.replace(/=(?:w\d+-h\d+|s\d+).*$/, sized);
      } else if (/=(?:w\d+-h\d+|s\d+)/.test(url.search)) {
        url.search = url.search.replace(/=(?:w\d+-h\d+|s\d+).*$/, sized);
      } else if (url.pathname.includes("=")) {
        url.pathname = `${url.pathname.replace(/=.*$/, "")}${sized}`;
      } else {
        url.pathname = `${url.pathname}${sized}`;
      }
      return url.href;
    }
    if (isYtimg(url.hostname)) {
      url.pathname = url.pathname
        .replace(/hqdefault\.jpg$/i, "hq720.jpg")
        .replace(/sddefault\.jpg$/i, "hq720.jpg")
        .replace(/mqdefault\.jpg$/i, "hq720.jpg")
        .replace(/default\.jpg$/i, "hq720.jpg");
      return url.href;
    }
    return url.href;
  } catch {
    return "";
  }
}

export function hasArtworkURL(src?: string): boolean {
  if (!src || failedSources.has(src)) return false;
  try {
    const host = new URL(src).hostname;
    if (isYtimg(host)) return false;
  } catch {
    return false;
  }
  const url = artworkURL(src);
  if (!url || failedUrls.has(url)) return false;
  return true;
}

const preloadQueue: Array<{ url: string; src: string }> = [];
const pendingUrls = new Set<string>();
let preloading = 0;

function preloadArtwork(url: string, src: string) {
  if (!url || loadedUrls.has(url) || failedUrls.has(url) || pendingUrls.has(url)) return;
  pendingUrls.add(url);
  preloadQueue.push({ url, src });
  warmArtwork();
}

export function preloadArtworkSource(src: string, size: number) {
  preloadArtwork(artworkURL(src, size * 2), src);
}

function warmArtwork() {
  while (preloading < 4 && preloadQueue.length) {
    const item = preloadQueue.shift()!;
    const image = new Image();
    preloading++;
    image.referrerPolicy = "no-referrer";
    image.fetchPriority = "low";
    const finish = (loaded: boolean) => {
      let allowWide = false;
      try { allowWide = isYtimg(new URL(item.url).hostname); } catch {}
      if (loaded && isAcceptableCover(image.naturalWidth, image.naturalHeight, allowWide)) markLoaded(item.url);
      pendingUrls.delete(item.url);
      preloading--;
      warmArtwork();
    };
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = item.url;
  }
}

export function Artwork({ src, size, className = "", lazy = false, rootMargin = "1000px 800px", onFail, placeholder = "music", allowNonSquare = false }: { src: string; size: number; className?: string; lazy?: boolean; rootMargin?: string; onFail?: () => void; placeholder?: "music" | "user" | ReactNode; allowNonSquare?: boolean }) {
  const url = artworkURL(src, size * 2);
  const allowWide = allowNonSquare || (() => {
    try { return Boolean(src && isYtimg(new URL(src).hostname)); } catch { return false; }
  })();
  const iconSize = Math.max(28, Math.min(56, Math.round(size * 0.32)));
  const Placeholder = typeof placeholder === "string"
    ? (placeholder === "user" ? <UserRound className="artwork-placeholder" size={iconSize} strokeWidth={1.75} /> : <Music2 className="artwork-placeholder" size={iconSize} strokeWidth={1.75} />)
    : placeholder;
  const ref = useRef<HTMLSpanElement>(null);
  const retryTimer = useRef<number | null>(null);
  const [visible, setVisible] = useState(!lazy || loadedUrls.has(url));
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(() => Boolean(url && loadedUrls.has(url)));
  const [failed, setFailed] = useState(() => Boolean(!url || failedUrls.has(url) || failedSources.has(src)));
  const isLoaded = Boolean(url && (loadedUrls.has(url) || loaded));
  const isFailed = Boolean(!url || failedUrls.has(url) || failedSources.has(src) || failed);
  const loading = Boolean(url && !isLoaded && !isFailed);
  const imageSrc = attempt > 0 && url ? `${url}${url.includes("?") ? "&" : "?"}retry=${attempt}` : url;

  useEffect(() => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    setAttempt(0);
    setLoaded(Boolean(url && loadedUrls.has(url)));
    setFailed(Boolean(!url || failedUrls.has(url) || failedSources.has(src)));
    setVisible(!lazy || Boolean(url && loadedUrls.has(url)));
  }, [url, src, lazy]);

  useEffect(() => {
    if (isFailed) onFail?.();
  }, [isFailed, onFail]);

  useEffect(() => {
    if (!lazy || !url) return;
    const timer = window.setTimeout(() => preloadArtwork(url, src), 250);
    return () => window.clearTimeout(timer);
  }, [url, src, lazy]);

  useEffect(() => {
    if (!lazy || visible || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [lazy, visible, rootMargin]);

  useEffect(() => () => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
  }, []);

  if (!url || isFailed) {
    return <span className={`artwork ${className}`} aria-hidden="true"><span className="artwork-placeholder-wrap">{Placeholder}</span></span>;
  }

  return <span ref={ref} className={`artwork ${className}`} data-loading={loading || undefined} aria-busy={loading}>
    {!isLoaded && <span className="artwork-placeholder-wrap" aria-hidden="true">{Placeholder}</span>}
    {(visible || isLoaded) && <img
      key={`${url}:${attempt}`}
      src={imageSrc}
      alt=""
      referrerPolicy="no-referrer"
      decoding="async"
      className={isLoaded ? "loaded" : ""}
      onLoad={(event) => {
        const image = event.currentTarget;
        if (isAcceptableCover(image.naturalWidth, image.naturalHeight, allowWide)) {
          markLoaded(url);
          setLoaded(true);
          setFailed(false);
          return;
        }
        markFailed(url, src);
        setFailed(true);
        setLoaded(false);
      }}
      onError={() => {
        if (attempt + 1 >= MAX_ATTEMPTS) {
          markFailed(url, src);
          setFailed(true);
          setLoaded(false);
          return;
        }
        if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => {
          retryTimer.current = null;
          setLoaded(false);
          setFailed(false);
          setAttempt((value) => value + 1);
        }, 450 * (attempt + 1));
      }}
    />}
  </span>;
}
