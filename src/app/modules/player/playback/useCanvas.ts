import { useEffect, useState } from "react";
import { Music, type Track } from "../../../mygo";

function durationSeconds(track: Track | null) {
  if (!track) return 0;
  const raw = track.duration_seconds;
  if (typeof raw === "number" && raw > 0) return Math.round(raw);
  const text = track.duration;
  if (!text || typeof text !== "string") return 0;
  const parts = text.split(":").map(Number);
  if (parts.some((value) => !Number.isFinite(value))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

export function useCanvas(track: Track | null) {
  const [url, setURL] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty">("idle");

  useEffect(() => {
    if (!track?.id || !track.title) {
      setURL("");
      setStatus("idle");
      return;
    }
    let active = true;
    const trackID = track.id;
    setURL("");
    setStatus("loading");
    void Music.canvas(track.title, track.artist || "", durationSeconds(track), trackID)
      .then((result) => {
        if (!active) return;
        const next = typeof result?.url === "string" ? result.url.trim() : "";
        if (next.startsWith("https://")) {
          setURL(next);
          setStatus("ready");
          return;
        }
        setURL("");
        setStatus("empty");
      })
      .catch(() => {
        if (!active) return;
        setURL("");
        setStatus("empty");
      });
    return () => {
      active = false;
    };
  }, [track?.id, track?.title, track?.artist, track?.duration, track?.duration_seconds]);

  return { url, status };
}
