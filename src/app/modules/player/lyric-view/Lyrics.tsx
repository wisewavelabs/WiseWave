import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Line, Track, Record } from "../../../mygo";
import type { LyricLine } from "../../../types/lyricRenderer";
import { artworkURL } from "../../../shared/ui/Artwork";
import LyricsRenderer from "./LyricsRenderer";
import { DEFAULT_LYRICS_THEME, useArtworkTheme } from "../shared/artworkColor";
import { createPlaybackClock, type PlaybackClock } from "./playbackClock";
import { normalizeLyricLines } from "./lyricLayout";

export function Lyrics({
  lines,
  credit,
  plain,
  loading,
  position,
  duration,
  playing,
  seekVersion,
  track,
  onSeek,
}: {
  lines: Line[];
  credit: Record | null;
  plain: string;
  loading: boolean;
  position: number;
  duration?: number;
  playing?: boolean;
  seekVersion: number;
  track?: Track | null;
  onSeek: (seconds: number) => void;
}) {
  const [settings, setSettings] = useState<{ lyrStyle?: string; lyr?: boolean; lyrSize?: string; lyrOffset?: string; art?: boolean }>(() => {
    try { return JSON.parse(localStorage.getItem("wisewave-settings") || "{}"); }
    catch { return {}; }
  });
  const offset = Number.parseInt(settings.lyrOffset || "0", 10) || 0;
  const fontSize = settings.lyrSize === "Small" ? 32 : settings.lyrSize === "Large" ? 48 : 40;
  const clockRef = useRef<PlaybackClock>(createPlaybackClock());
  const clock = clockRef.current;

  useEffect(() => {
    const update = (event: Event) => setSettings((event as CustomEvent<typeof settings>).detail);
    window.addEventListener("wisewave-settings-changed", update);
    return () => window.removeEventListener("wisewave-settings-changed", update);
  }, []);

  useLayoutEffect(() => {
    clock.update(
      Math.max(0, position - offset / 1000),
      duration || 0,
      Boolean(playing),
      track?.id,
      undefined,
      seekVersion
    );
  }, [clock, position, duration, playing, track?.id, seekVersion, offset]);

  const plainText = useMemo(() => {
    const value = plain.trim();
    if (!value) return "";
    const normalized = value.toLowerCase().replace(/[.!]+$/g, "");
    if (normalized === "lyrics unavailable" || normalized === "no lyrics found" || normalized === "lyrics not found") return "";
    return value;
  }, [plain]);
  const normalized = useMemo<LyricLine[]>(() => {
    if (settings.lyr === false) {
      const text = plainText ? plainText.split(/\r?\n/) : lines.filter((line) => !line.is_background).map((line) => line.text);
      return text.filter((line) => line?.trim()).map((text) => ({ text, startTimeMs: null }));
    }
    return lines.length ? normalizeLyricLines(lines) : plainText.split(/\r?\n/).filter((line) => line.trim()).map((text) => ({ text, startTimeMs: null }));
  }, [lines, plainText, settings.lyr]);
  const hasWords = useMemo(
    () => normalized.some((l) => l.syllables && l.syllables.length > 0),
    [normalized]
  );
  const type: "SYLLABLE_SYNCED" | "LINE_SYNCED" | "PLAIN" = settings.lyr === false ? "PLAIN" : hasWords
    ? "SYLLABLE_SYNCED"
    : lines.length > 0
    ? "LINE_SYNCED"
    : "PLAIN";

  const handleSelect = useCallback(
    (positionMs: number) => {
      onSeek(Math.max(0, (positionMs + offset) / 1000));
    },
    [onSeek, offset]
  );

  const unavailable = !loading && !lines.length && !plainText;
  const dynamicBackground = settings.art !== false;
  const artworkTheme = useArtworkTheme(track);
  const theme = dynamicBackground ? artworkTheme : DEFAULT_LYRICS_THEME;
  const artworkSrc = track?.album_art_url || "";
  const resolvedBackdrop = dynamicBackground && artworkSrc ? artworkURL(artworkSrc, 160) || artworkSrc : "";
  const [backdropUrl, setBackdropUrl] = useState(resolvedBackdrop);
  const [backdropFailed, setBackdropFailed] = useState(false);

  useEffect(() => {
    setBackdropUrl(resolvedBackdrop);
    setBackdropFailed(false);
  }, [resolvedBackdrop, track?.id]);

  const showBlur = Boolean(backdropUrl) && !backdropFailed;

  const durationSeconds =
    typeof track?.duration_seconds === "number"
      ? track.duration_seconds
      : typeof track?.duration === "number"
      ? track.duration
      : 0;

  const rendererTrack = {
    trackId: track?.id || "",
    duration: durationSeconds * 1000,
    artworkUrl: track?.album_art_url || null,
  };

  return (
    <div
      className={`player-lyrics-wrapper${showBlur ? " has-blur-bg" : ""}`}
      style={
        {
          "--lyrics-font-size": `${fontSize}px`,
          "--lyrics-font-scale": fontSize / 40,
          "--lyrics-bg": theme.background,
          "--lyrics-active-text": theme.activeText,
          "--lyrics-inactive-text": theme.inactiveText,
          "--lyrics-flipbook-fill": theme.flipbookFill,
        } as CSSProperties
      }
    >
      {backdropUrl ? (
        <img
          className="player-lyrics-backdrop"
          src={backdropUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            if (backdropUrl !== artworkSrc && artworkSrc) {
              setBackdropUrl(artworkSrc);
              return;
            }
            setBackdropFailed(true);
          }}
        />
      ) : null}
      <LyricsRenderer
        credit={credit}
        activeIndex={-1}
        clock={clock}
        isLoading={loading}
        lines={normalized}
        lyricsRef={useRef<HTMLDivElement>(null)}
        onSelect={handleSelect}
        style={settings.lyrStyle === "Focus" ? "Focus" : "Default"}
        syncVersion={seekVersion}
        track={rendererTrack}
        translationLines={null}
        type={type}
        unavailable={unavailable}
      />
    </div>
  );
}
