import { useEffect, useState } from "react";
import type { Track } from "../../../mygo";
import { artworkURL } from "../../../shared/ui/Artwork";

export interface LyricsTheme {
  background: string;
  activeText: string;
  inactiveText: string;
  flipbookFill: string;
  gradient: string;
}

export const DEFAULT_LYRICS_THEME: LyricsTheme = {
  background: "#58001b",
  activeText: "#ffffff",
  inactiveText: "#c99093",
  flipbookFill: "#d8a5b2",
  gradient: "linear-gradient(to bottom, #58001b 0%, #2c222a 60%, #0c0c0c 100%)",
};

export const DEFAULT_PLAYLIST_THEME: LyricsTheme = {
  background: "#343343",
  activeText: "#ffffff",
  inactiveText: "#a4a4a4",
  flipbookFill: "#d8d8dc",
  gradient: "linear-gradient(to bottom, #343343 0%, #202028 60%, #0c0c0c 100%)",
};

const themeCache = new Map<string, LyricsTheme>();
const MAX_CACHE_SIZE = 250;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [Math.round(h * 360), s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

interface ColorBucket {
  rSum: number;
  gSum: number;
  bSum: number;
  count: number;
}

interface Swatch {
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
  population: number;
}

export async function extractArtworkTheme(imageUrl: string): Promise<LyricsTheme> {
  if (!imageUrl) return DEFAULT_LYRICS_THEME;
  const cached = themeCache.get(imageUrl);
  if (cached) return cached;

  try {
    const img = new Image();
    if (/^https?:/i.test(imageUrl)) {
      img.crossOrigin = "anonymous";
      img.referrerPolicy = "no-referrer";
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          resolve();
        }
      };
      const fail = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(new Error("Image failed to load"));
        }
      };

      const timeoutId = setTimeout(fail, 4000);
      img.onload = done;
      img.onerror = fail;
      img.src = imageUrl;
      if (img.complete && img.naturalWidth > 0) done();
    });

    const canvas = document.createElement("canvas");
    const sampleSize = 48;
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return DEFAULT_LYRICS_THEME;

    ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
    const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
    const pixels = imageData.data;

    // 5-bit color quantization into buckets
    const bucketMap = new Map<number, ColorBucket>();
    let totalSamples = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      const a = pixels[i + 3];
      if (a < 128) continue;

      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];

      const [, , l] = rgbToHsl(r, g, b);
      // Filter out extreme blacks (letterboxing/borders) and blown-out pure whites
      if (l < 0.06 || l > 0.94) continue;

      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let bucket = bucketMap.get(key);
      if (!bucket) {
        bucket = { rSum: 0, gSum: 0, bSum: 0, count: 0 };
        bucketMap.set(key, bucket);
      }
      bucket.rSum += r;
      bucket.gSum += g;
      bucket.bSum += b;
      bucket.count += 1;
      totalSamples += 1;
    }

    if (totalSamples === 0 || bucketMap.size === 0) {
      themeCache.set(imageUrl, DEFAULT_LYRICS_THEME);
      return DEFAULT_LYRICS_THEME;
    }

    const sortedBuckets = Array.from(bucketMap.values()).sort((a, b) => b.count - a.count);

    const swatches: Swatch[] = [];
    for (const b of sortedBuckets.slice(0, 32)) {
      const r = Math.round(b.rSum / b.count);
      const g = Math.round(b.gSum / b.count);
      const blue = Math.round(b.bSum / b.count);
      const [h, s, l] = rgbToHsl(r, g, blue);

      const existing = swatches.find(
        (sw) => Math.hypot(sw.r - r, sw.g - g, sw.b - blue) < 32 || (Math.abs(sw.h - h) < 18 && Math.abs(sw.s - s) < 0.22)
      );
      if (existing) {
        existing.population += b.count;
      } else {
        swatches.push({ r, g, b: blue, h, s, l, population: b.count });
      }
    }

    // Prioritize chromatic swatches so dull studio/backdrop areas never overpower real album colors
    const chromaticSwatches = swatches.filter((sw) => sw.s >= 0.18);
    const candidatePool = chromaticSwatches.length > 0 ? chromaticSwatches : swatches;

    const maxPop = Math.max(...candidatePool.map((s) => s.population), 1);

    // Vibrant scoring: heavily favors vivid saturation and healthy mid-tones
    let bestSwatch = candidatePool[0];
    let bestScore = -1;

    for (const sw of candidatePool) {
      // Saturation is the most critical factor for a rich album color
      const satScore = sw.s * 0.55;
      // Population factor with square root to prevent huge backgrounds from eclipsing vibrant subjects
      const popScore = Math.sqrt(sw.population / maxPop) * 0.25;
      // Lightness sweet spot around 0.30 - 0.60
      const lightScore = Math.max(0, 1 - Math.abs(sw.l - 0.45) * 1.5) * 0.20;

      const score = satScore + popScore + lightScore;
      if (score > bestScore) {
        bestScore = score;
        bestSwatch = sw;
      }
    }

    const h = bestSwatch.h;
    const rawSat = bestSwatch.s;
    let background: string;
    let midColor: string;
    let activeText: string;
    let inactiveText: string;
    let flipbookFill: string;

    if (rawSat < 0.15) {
      // Clean dark neutral slate for monochrome / black & white covers
      background = "#242428";
      midColor = "#161619";
      activeText = "#ffffff";
      inactiveText = "rgba(255, 255, 255, 0.48)";
      flipbookFill = "#d8d8dc";
    } else {
      // 1:1 tuned to Liked Songs palette curve (depth ~23% lightness, sophisticated ~30% saturation, ~15% mid-tone)
      const bgSat = Math.min(Math.max(rawSat * 0.75, 0.26), 0.38);
      const bgLight = 0.23;
      const midSat = bgSat * 0.46;
      const midLight = 0.15;
      background = hslToHex(h, bgSat, bgLight);
      midColor = hslToHex(h, midSat, midLight);

      activeText = "#ffffff";
      // Tinted inactive text matching the hue at high lightness (> 5:1 contrast)
      inactiveText = hslToHex(h, Math.min(bgSat * 0.5, 0.35), 0.75);
      flipbookFill = hslToHex(h, Math.min(bgSat, 0.65), 0.82);
    }

    const gradient = `linear-gradient(to bottom, ${background} 0%, ${midColor} 60%, #0c0c0c 100%)`;

    const theme: LyricsTheme = {
      background,
      activeText,
      inactiveText,
      flipbookFill,
      gradient,
    };

    if (themeCache.size >= MAX_CACHE_SIZE) {
      themeCache.delete(themeCache.keys().next().value!);
    }
    themeCache.set(imageUrl, theme);

    return theme;
  } catch {
    return DEFAULT_LYRICS_THEME;
  }
}

export function useImageTheme(imageUrl: string | null | undefined, fallback: LyricsTheme = DEFAULT_LYRICS_THEME): LyricsTheme {
  const artworkUrl = imageUrl || "";
  const [theme, setTheme] = useState<LyricsTheme>(() => {
    if (artworkUrl && themeCache.has(artworkUrl)) {
      return themeCache.get(artworkUrl)!;
    }
    return fallback;
  });

  useEffect(() => {
    if (!artworkUrl) {
      setTheme(fallback);
      return;
    }

    if (themeCache.has(artworkUrl)) {
      setTheme(themeCache.get(artworkUrl)!);
      return;
    }

    let cancelled = false;
    extractArtworkTheme(artworkUrl).then((extracted) => {
      if (!cancelled) {
        setTheme(extracted === DEFAULT_LYRICS_THEME ? fallback : extracted);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [artworkUrl, fallback]);

  return theme;
}

export function useArtworkTheme(track: Track | null | undefined): LyricsTheme {
  const rawUrl = track?.album_art_url || "";
  return useImageTheme(artworkURL(rawUrl, 256) || rawUrl || null, DEFAULT_LYRICS_THEME);
}
