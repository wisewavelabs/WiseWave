import { useCallback, useEffect, useRef, useState } from "react";
import { GripHorizontal, Heart, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { MiniWindow, type Track } from "../../../mygo";
import { ArtistLinks } from "../shared/ArtistLinks";
import { Artwork } from "../../../shared/ui/Artwork";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon } from "../../../shared/ui/icons";
import { PlayerAlert } from "../shared/PlayerAlert";

export type MiniState = {
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  liked: boolean;
};

const empty: MiniState = {
  track: null,
  playing: false,
  position: 0,
  duration: 0,
  volume: 100,
  muted: false,
  hasPrevious: false,
  hasNext: false,
  liked: false,
};

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function VerticalVolume({
  setVolume,
  disabled,
  value,
}: {
  setVolume: (value: number) => void;
  disabled: boolean;
  value: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latestValueRef = useRef(value);
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const percentage = Math.min(100, Math.max(0, dragValue ?? value));

  const setFromClientY = useCallback((clientY: number) => {
    if (disabled || !ref.current) return;
    const rectangle = ref.current.getBoundingClientRect();
    const nextValue = Math.min(1, Math.max(0, (rectangle.bottom - clientY) / rectangle.height)) * 100;
    latestValueRef.current = nextValue;
    setDragValue(nextValue);
    setVolume(nextValue);
  }, [setVolume, disabled]);

  useEffect(() => {
    if (!dragging) latestValueRef.current = value;
  }, [dragging, value]);

  return (
    <div
      aria-label="Volume"
      aria-orientation="vertical"
      aria-disabled={disabled}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(dragValue ?? value)}
      className="mini-volume-slider"
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (disabled || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const nextValue = event.key === "ArrowUp" ? Math.min(100, value + 10) : Math.max(0, value - 10);
        latestValueRef.current = nextValue;
        setVolume(nextValue);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromClientY(event.clientY);
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        setFromClientY(event.clientY);
        setDragging(false);
        setDragValue(null);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => { setDragging(false); setDragValue(null); }}
      onPointerCancel={() => { setDragging(false); setDragValue(null); }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        setFromClientY(event.clientY);
      }}
    >
      <span className="mini-volume-track">
        <span
          className={`mini-volume-fill ${dragging ? "dragging" : ""}`}
          style={{ height: `${percentage}%` }}
        />
      </span>
      <span
        className={`mini-volume-thumb ${dragging ? "visible dragging" : ""}`}
        style={{ bottom: `${percentage}%` }}
      />
    </div>
  );
}

function PlayerSlider({
  disabled = false,
  label,
  max,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  max: number;
  onChange: (value: number) => void;
  value: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latestValueRef = useRef(value);
  const [dragging, setDragging] = useState(false);
  const pointerRef = useRef<number | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const displayedValue = dragValue ?? value;
  const percentage = max > 0 ? Math.min(100, Math.max(0, (displayedValue / max) * 100)) : 0;

  const resolveValueFromClientX = useCallback(
    (clientX: number) => {
      if (disabled || !ref.current || !Number.isFinite(max) || max <= 0) return null;
      const rect = ref.current.getBoundingClientRect();
      if (!rect.width) return null;
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * max;
    },
    [disabled, max]
  );

  const setFromClientX = useCallback(
    (clientX: number) => {
      const nextValue = resolveValueFromClientX(clientX);
      if (nextValue === null) return;
      latestValueRef.current = nextValue;
      setHoverValue(nextValue);
      setDragValue(nextValue);
      onChange(nextValue);
    },
    [onChange, resolveValueFromClientX]
  );

  useEffect(() => {
    if (!dragging) latestValueRef.current = value;
  }, [dragging, value]);

  useEffect(() => {
    if (!disabled) return;
    pointerRef.current = null;
    setDragging(false);
    setDragValue(null);
    setHoverValue(null);
  }, [disabled]);

  const tooltipValue = hoverValue ?? value;
  const tooltipPercentage = max > 0 ? Math.min(100, Math.max(0, (tooltipValue / max) * 100)) : 0;

  return (
    <div
      aria-label={label}
      aria-disabled={disabled}
      aria-valuemax={Math.round(max)}
      aria-valuemin={0}
      aria-valuenow={Math.round(displayedValue)}
      className={`mini-slider-root ${disabled ? "disabled" : ""}`}
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
        e.preventDefault();
        const step = max * 0.05;
        const nextValue = e.key === "ArrowRight" ? Math.min(max, value + step) : Math.max(0, value - step);
        latestValueRef.current = nextValue;
        onChange(nextValue);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (disabled || e.button !== 0 || pointerRef.current !== null) return;
        e.preventDefault();
        pointerRef.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (disabled) return;
        const next = resolveValueFromClientX(e.clientX);
        setHoverValue(next);
        if (pointerRef.current === e.pointerId) {
          setFromClientX(e.clientX);
        }
      }}
      onPointerLeave={() => {
        if (!dragging) setHoverValue(null);
      }}
      onPointerUp={(e) => {
        if (pointerRef.current !== e.pointerId) return;
        setFromClientX(e.clientX);
        pointerRef.current = null;
        setDragging(false);
        setDragValue(null);
        setHoverValue(null);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {}
      }}
      onLostPointerCapture={() => {
        if (pointerRef.current === null) return;
        pointerRef.current = null;
        setDragging(false);
        setDragValue(null);
        setHoverValue(null);
      }}
      onPointerCancel={() => {
        pointerRef.current = null;
        setDragging(false);
        setDragValue(null);
        setHoverValue(null);
      }}
    >
      <div className="mini-slider-track">
        <div className="mini-slider-fill" style={{ width: `${percentage}%` }} />
        <div
          className={`mini-slider-thumb ${dragging ? "dragging" : ""}`}
          style={{ left: `${percentage}%` }}
        />
      </div>

      {(hoverValue !== null || dragging) && (
        <div
          className="mini-slider-tooltip"
          style={{ left: `${tooltipPercentage}%` }}
        >
          {formatTime(tooltipValue)}
        </div>
      )}
    </div>
  );
}

export function MiniPlayer() {
  const [state, setState] = useState(empty);
  const [error, setError] = useState("");
  const [hovered, setHovered] = useState(false);
  const [volumePreview, setVolumePreview] = useState<number | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  const close = () => {
    void MiniWindow.close().catch(() => setError("Mini player could not be closed."));
  };

  useEffect(() => {
    const handleMouseLeave = (e: MouseEvent) => {
      if (!e.relatedTarget && (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight)) {
        setHovered(false);
      }
    };
    const handleBlur = () => {
      setHovered(false);
    };
    window.addEventListener("blur", handleBlur);
    document.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  useEffect(() => {
    const bus = new BroadcastChannel("wisewave-mini");
    channel.current = bus;
    bus.onmessage = (event) => {
      if (event.data?.type === "state") setState(event.data.state);
    };
    bus.postMessage({ type: "request" });
    const closed = () => bus.postMessage({ type: "closed" });
    window.addEventListener("beforeunload", closed);

    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || (event.altKey && event.key.toLowerCase() === "m")) {
        close();
      } else if (
        event.key === " " &&
        !(event.target instanceof Element && event.target.closest("input, [role='slider'], button"))
      ) {
        event.preventDefault();
        send("toggle");
      }
    };
    window.addEventListener("keydown", keydown);

    return () => {
      window.removeEventListener("beforeunload", closed);
      window.removeEventListener("keydown", keydown);
      closed();
      bus.close();
      channel.current = null;
    };
  }, []);

  const send = (action: string, value?: number) => {
    channel.current?.postMessage({ type: "action", action, value, trackId: state.track?.id });
  };

  const handleActionClick = (action: string, event: React.MouseEvent) => {
    (event.currentTarget as HTMLElement).blur();
    send(action);
  };

  useEffect(() => {
    if (volumePreview !== null && !state.muted && Math.abs(state.volume - volumePreview) < 0.01) setVolumePreview(null);
  }, [state.volume, state.muted, volumePreview]);
  useEffect(() => { setVolumePreview(null); }, [state.track?.id]);

  const displayedVolume = volumePreview ?? (state.muted ? 0 : state.volume);
  const VolumeIcon = displayedVolume === 0 ? VolumeX : displayedVolume < 50 ? Volume1 : Volume2;

  return (
    <main
      className="mini-player"
      onPointerLeave={() => setHovered(false)}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="mini-drag" data-tauri-drag-region>
        <GripHorizontal size={16} />
      </div>

      <Tooltip label="Close mini player" className="mini-close-wrap">
        <button
          className="mini-close"
          type="button"
          aria-label="Close mini player"
          onClick={close}
        >
          <X size={16} />
        </button>
      </Tooltip>

      <div
        className={`mini-art-area ${hovered ? "hovered" : ""}`}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      onContextMenu={(event) => event.preventDefault()}
      >
        <div className="mini-art-image">
          <Artwork
            className="size-full"
            src={state.track?.album_art_url || ""}
            size={300}
          />
        </div>

        <div className="mini-shade-top" />

        <div className="mini-controls-overlay">
          <Tooltip label="Previous">
            <button
              className="mini-ctrl-btn"
              type="button"
              aria-label="Previous"
              disabled={!state.hasPrevious}
              onClick={(e) => handleActionClick("previous", e)}
            >
              <PreviousIcon />
            </button>
          </Tooltip>

          <Tooltip label={state.playing ? "Pause" : "Play"}>
            <button
              className="mini-ctrl-play"
              type="button"
              aria-label={state.playing ? "Pause" : "Play"}
              disabled={!state.track}
              onClick={(e) => handleActionClick("toggle", e)}
            >
              {state.playing ? <PauseIcon /> : <PlayIcon />}
            </button>
          </Tooltip>

          <Tooltip label="Next">
            <button
              className="mini-ctrl-btn"
              type="button"
              aria-label="Next"
              disabled={!state.hasNext}
              onClick={(e) => handleActionClick("next", e)}
            >
              <NextIcon />
            </button>
          </Tooltip>

          <div className="mini-volume-wrapper">
            <div className="mini-volume-popup">
              <div className="mini-volume-card">
                <VerticalVolume
                  disabled={!state.track}
                  value={displayedVolume}
                  setVolume={(val) => { setVolumePreview(val); send("volume", val); }}
                />
                <span className="mini-volume-text">{Math.round(displayedVolume)}%</span>
              </div>
            </div>

            <Tooltip label={state.muted ? "Unmute" : "Mute"}>
              <button
                className="mini-volume-btn"
                type="button"
                aria-label={state.muted ? "Unmute" : "Mute"}
                disabled={!state.track}
                onClick={(e) => { setVolumePreview(null); handleActionClick("mute", e); }}
              >
                <VolumeIcon size={20} />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="mini-shade-bottom" />

        <div className="mini-bottom">
          {state.track && (
            <div className="mini-track-meta">
              <div className="mini-title-row">
                <div className="mini-title-container">
                  <MarqueeText className="mini-title">
                    {state.track.title}
                  </MarqueeText>
                </div>
                <Tooltip label={state.liked ? "Remove from Liked Songs" : "Save to Liked Songs"}>
                  <button
                    aria-label={state.liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
                    aria-pressed={state.liked}
                    className={`mini-like-btn ${state.liked ? "liked" : ""}`}
                    type="button"
                    onClick={(e) => handleActionClick("like", e)}
                  >
                    <Heart size={16} fill={state.liked ? "currentColor" : "none"} />
                  </button>
                </Tooltip>
              </div>
              <div className="mini-artist">
                <MarqueeText className="mini-artist-text">
                  <ArtistLinks track={state.track} onOpen={(track) => channel.current?.postMessage({ type: "artist", track })} />
                </MarqueeText>
              </div>
            </div>
          )}

          <div className="mini-times">
            <span>{state.duration ? formatTime(state.position) : "-:--"}</span>
            <span>{state.duration ? formatTime(state.duration) : "-:--"}</span>
          </div>

          <div className="mini-slider-wrap">
            <PlayerSlider
              disabled={!state.track || !state.duration}
              label="Seek"
              max={state.duration || 1}
              value={state.position}
              onChange={(val) => send("seek", val)}
            />
          </div>

          <PlayerAlert message={error} onDismiss={() => setError("")} />
        </div>
      </div>
    </main>
  );
}
