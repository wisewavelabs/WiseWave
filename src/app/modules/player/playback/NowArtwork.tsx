import { useEffect, useRef, useState } from "react";
import type { Track } from "../../../mygo";
import { Artwork, artworkURL, hasArtworkURL } from "../../../shared/ui/Artwork";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { useCanvas } from "./useCanvas";

export type NowMediaOpen = { kind: "artwork" } | { kind: "canvas"; url: string };

export function NowArtwork({
  track,
  playing,
  onOpen,
}: {
  track: Track;
  playing: boolean;
  onOpen: (media: NowMediaOpen) => void;
}) {
  const canvas = useCanvas(track);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasCanvas = canvas.status === "ready" && !!canvas.url;
  const cover = hasArtworkURL(track.album_art_url) ? artworkURL(track.album_art_url, 720) : "";
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    setCoverFailed(false);
  }, [track.id, cover]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasCanvas) return;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    if (playing) {
      const play = video.play();
      if (play && typeof play.catch === "function") play.catch(() => {});
    } else {
      video.pause();
    }
  }, [playing, hasCanvas, canvas.url, track.id]);

  return (
    <Tooltip label={hasCanvas ? "Expand canvas" : "Expand cover"}>
      <button
        className={`now-artwork ${hasCanvas ? "has-canvas" : "has-cover"}`}
        type="button"
        aria-label={hasCanvas ? "Expand canvas video" : "Expand album artwork"}
        onClick={() => {
          if (hasCanvas && canvas.url) onOpen({ kind: "canvas", url: canvas.url });
          else onOpen({ kind: "artwork" });
        }}
      >
        <span className="now-artwork-media">
          {hasCanvas ? (
            <video
              key={`${track.id}-${canvas.url}`}
              ref={videoRef}
              className="now-canvas"
              src={canvas.url}
              poster={cover || undefined}
              muted
              loop
              playsInline
              autoPlay={playing}
              preload="metadata"
            />
          ) : cover && !coverFailed ? (
            <img
              className="now-cover"
              src={cover}
              alt=""
              draggable={false}
              referrerPolicy="no-referrer"
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <Artwork className="now-cover-fallback" src={track.album_art_url} size={560} />
          )}
        </span>
        <span className="now-artwork-fade" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
