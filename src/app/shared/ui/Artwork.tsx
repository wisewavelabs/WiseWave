import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";

const loadedUrls = new Set<string>();
const failedUrls = new Set<string>();
const failedSources = new Set<string>();

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

export function artworkURL(src: string, size = 512) {
  try {
    const url = new URL(src);
    if (url.protocol !== "https:" || /(^|\.)ytimg\.com$/i.test(url.hostname)) return "";
    if (url.hostname === "c.saavncdn.com") {
      url.pathname = url.pathname.replace(/(?:50|150)x(?:50|150)/g, "500x500");
      return url.href;
    }
    if (url.hostname.endsWith("mzstatic.com")) {
      url.pathname = url.pathname.replace(/\/(?:\{w\}x\{h\}|\d+x\d+)(?:bb|cw)(?:-\d+)?\.(?:jpe?g|png|webp)$/i, `/${size}x${size}bb.jpg`);
      return url.href;
    }
    if (url.hostname.endsWith(".googleusercontent.com") || url.hostname.endsWith(".ggpht.com")) {
      if (/=(?:w\d+-h\d+|s\d+)/.test(url.pathname)) {
        url.pathname = url.pathname.replace(/=(?:w\d+-h\d+|s\d+).*$/, `=w${size}-h${size}-l90-rj`);
      } else {
        url.pathname = `${url.pathname}=w${size}-h${size}-l90-rj`;
      }
      return url.href;
    }
    return url.href;
  } catch { return ""; }
}

export function hasArtworkURL(src?: string): boolean {
  if (!src || failedSources.has(src)) return false;
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

function warmArtwork() {
  while (preloading < 4 && preloadQueue.length) {
    const item = preloadQueue.shift()!;
    const image = new Image();
    preloading++;
    image.referrerPolicy = "no-referrer";
    image.fetchPriority = "low";
    const finish = (loaded: boolean) => {
      if (loaded && image.naturalWidth >= 64 && Math.abs(image.naturalWidth - image.naturalHeight) <= 1) {
        markLoaded(item.url);
      } else {
        markFailed(item.url, item.src);
      }
      pendingUrls.delete(item.url);
      preloading--;
      warmArtwork();
    };
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = item.url;
  }
}

export function Artwork({ src, size, className = "", lazy = false, rootMargin = "1000px 800px", onFail }: { src: string; size: number; className?: string; lazy?: boolean; rootMargin?: string; onFail?: () => void }) {
  const url = artworkURL(src, size * 2);
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(!lazy || loadedUrls.has(url));
  const [status, setStatus] = useState({ url: "", loaded: false, failed: false, attempt: 0 });
  const isLoaded = Boolean(url && (loadedUrls.has(url) || (status.url === url && status.loaded)));
  const isFailed = Boolean(!url || failedUrls.has(url) || failedSources.has(src) || (status.url === url && status.failed));

  const loading = Boolean(url && !isLoaded && !isFailed && !(status.url === url && status.failed && status.attempt >= 1));

  useEffect(() => {
    if (!url || isFailed || (status.url === url && status.failed && status.attempt >= 1)) {
      onFail?.();
    }
  }, [url, isFailed, status.failed, status.attempt, onFail]);

  useEffect(() => {
    if (status.url !== url || !status.failed || status.attempt >= 1 || failedUrls.has(url)) return;
    const timer = window.setTimeout(() => setStatus({ url, loaded: false, failed: false, attempt: 1 }), 800);
    return () => window.clearTimeout(timer);
  }, [url, status]);

  useEffect(() => {
    if (!lazy || !url) return;
    const timer = window.setTimeout(() => preloadArtwork(url, src), 250);
    return () => window.clearTimeout(timer);
  }, [url, src, lazy]);

  useEffect(() => {
    if (!lazy || visible || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [lazy, visible, rootMargin]);

  if (isFailed || !url) {
    return null;
  }

  return <span ref={ref} className={`artwork ${className}`} data-loading={loading} aria-busy={loading}>
    {!isLoaded && !loading && <Music2 className="artwork-placeholder" aria-hidden="true" />}
    {(visible || isLoaded) && url && !isFailed && <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      className={isLoaded ? "loaded" : ""}
      onLoad={(event) => {
        const image = event.currentTarget;
        const square = image.naturalWidth >= 64 && Math.abs(image.naturalWidth - image.naturalHeight) <= 1;
        if (square) {
          markLoaded(url);
          setStatus({ url, loaded: true, failed: false, attempt: 0 });
        } else {
          markFailed(url, src);
          setStatus({ url, loaded: false, failed: true, attempt: 1 });
          onFail?.();
        }
      }}
      onError={() => {
        markFailed(url, src);
        setStatus({ url, loaded: false, failed: true, attempt: 1 });
        onFail?.();
      }}
    />}
  </span>;
}
