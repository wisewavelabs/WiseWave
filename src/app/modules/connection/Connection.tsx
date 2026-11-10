import { Classic } from "../../shared/ui/Classic";
import { Tooltip } from "../../shared/ui/Tooltip";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw, Unplug } from "lucide-react";
import { Playback, type PlaybackState } from "../../mygo";
import type { useMusic } from "../player/playback/useMusic";

const ACTION_CONFIRMATION_HOLD_MS = 1250;
const ACTION_CONFIRMATION_RETURN_MS = 600;

export function Connection({ music }: { music?: ReturnType<typeof useMusic> }) {
  const [open, setOpen] = useState(false);
  const [localState, setLocalState] = useState<PlaybackState | null>(null);
  const [pendingAction, setPendingAction] = useState<"reset" | "stop" | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ action: "reset" | "stop"; returning: boolean } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const confirmationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    void Playback.state().then((state) => {
      if (state.sample_rate || state.bitrate || state.playing) setLocalState(state);
    }).catch(() => {});
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        container.current?.querySelector("button")?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      if (confirmationTimerRef.current) clearTimeout(confirmationTimerRef.current);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const showActionConfirmation = (action: "reset" | "stop", onComplete?: () => void) => {
    setActionFeedback({ action, returning: false });
    if (confirmationTimerRef.current) clearTimeout(confirmationTimerRef.current);
    confirmationTimerRef.current = setTimeout(() => {
      setActionFeedback({ action, returning: true });
      confirmationTimerRef.current = setTimeout(() => {
        setActionFeedback(null);
        onComplete?.();
      }, ACTION_CONFIRMATION_RETURN_MS);
    }, ACTION_CONFIRMATION_HOLD_MS);
  };

  const handleReset = async () => {
    if (pendingAction || actionFeedback || !music?.resetAudioEngine) return;
    setPendingAction("reset");
    try {
      await music.resetAudioEngine();
      showActionConfirmation("reset");
    } finally {
      setPendingAction(null);
    }
  };

  const handleStop = () => {
    if (pendingAction || actionFeedback || !music?.stopPlayback) return;
    setPendingAction("stop");
    try {
      music.stopPlayback();
      showActionConfirmation("stop");
    } finally {
      setPendingAction(null);
    }
  };

  const state = (music?.playbackState?.sample_rate || music?.playbackState?.bitrate)
    ? music.playbackState
    : localState;

  const hasAudio = Boolean(music?.track && state);
  const isPlaying = Boolean(music?.playing);

  const streamQuality = hasAudio && state?.bitrate
    ? `${Math.round(state.bitrate / 1000)} kbps`
    : "—";

  const audioCodec = hasAudio && state?.codec
    ? state.codec
    : "—";

  const sampleRate = hasAudio && state?.sample_rate
    ? `${(state.sample_rate / 1000).toFixed(0)} kHz`
    : "—";

  const bufferAhead = hasAudio && isPlaying && state?.buffer_ahead != null
    ? `${state.buffer_ahead.toFixed(1)}s`
    : "—";

  const audioChannels = hasAudio && state?.channels
    ? (state.channels === 1 ? "Mono" : state.channels === 2 ? "Stereo" : `${state.channels} channels`)
    : "—";

  const latencyMetric = isPlaying && state?.latency_ms
    ? `${state.latency_ms} ms`
    : "—";

  const rows = [
    { label: "Stream quality", value: streamQuality },
    { label: "Audio codec", value: audioCodec },
    { label: "Sample rate", value: sampleRate },
    { label: "Buffer ahead", value: bufferAhead },
    { label: "Audio channels", value: audioChannels },
  ];

  const statusDot = (
    <span className="connection-status-dot">
      {isPlaying ? <span className="connection-ping" /> : null}
      <span className={`connection-dot ${isPlaying ? "live" : ""}`} />
    </span>
  );

  const isResetActive = pendingAction === "reset" || actionFeedback?.action === "reset";
  const isResetReturning = actionFeedback?.action === "reset" && actionFeedback.returning;
  const isResetPending = pendingAction === "reset";

  const isStopActive = pendingAction === "stop" || actionFeedback?.action === "stop";
  const isStopReturning = actionFeedback?.action === "stop" && actionFeedback.returning;
  const isStopPending = pendingAction === "stop";

  return <div className="connection" ref={container}>
    <Tooltip label="Audio connection"><button className="connection-trigger" type="button" aria-label="Audio connection details" aria-expanded={open} aria-controls="connection-details" onClick={() => setOpen((current) => !current)}>
      {statusDot}<span>{latencyMetric}</span><ChevronDown size={12} className={open ? "connection-chevron open" : "connection-chevron"} />
    </button></Tooltip>
    {open && <div className="connection-dropdown" id="connection-details">
      <div className="connection-info">
        <div className="connection-heading"><strong>Audio connection</strong><span>{statusDot}{latencyMetric}</span></div>
        <dl>{rows.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </div>
      <div className="connection-separator" />
      <button
        className={`connection-action ${pendingAction || actionFeedback ? "is-busy" : ""}`}
        type="button"
        disabled={!music?.track || Boolean(pendingAction || actionFeedback)}
        onClick={() => { void handleReset(); }}
      >
        <span className={`connection-action-content ${isResetActive ? isResetReturning ? "connection-action-return" : "connection-action-exit" : ""}`}>
          <RefreshCw size={16} className="recreate-icon" />Reset audio engine
        </span>
        {isResetActive && (
          <span aria-live="polite" className={`connection-action-confirm ${isResetPending ? "" : "confirmed"} ${isResetReturning ? "connection-action-confirm-exit" : ""}`}>
            {isResetPending && <Classic />}
            <span className={isResetPending ? "connection-action-pending-text" : "connection-action-confirm-text"}>
              {isResetPending ? "Resetting audio engine" : "Audio engine reset"}
            </span>
          </span>
        )}
      </button>
      <button
        className={`connection-action disconnect ${pendingAction || actionFeedback ? "is-busy" : ""}`}
        type="button"
        disabled={(!music?.track && !music?.playing) || Boolean(pendingAction || actionFeedback)}
        onClick={() => { handleStop(); }}
      >
        <span className={`connection-action-content ${isStopActive ? isStopReturning ? "connection-action-return" : "connection-action-exit" : ""}`}>
          <Unplug size={16} />Stop playback
        </span>
        {isStopActive && (
          <span aria-live="polite" className={`connection-action-confirm ${isStopPending ? "" : "confirmed"} ${isStopReturning ? "connection-action-confirm-exit" : ""}`}>
            {isStopPending && <Classic />}
            <span className={isStopPending ? "connection-action-pending-text" : "connection-action-confirm-text"}>
              {isStopPending ? "Stopping playback" : "Playback stopped"}
            </span>
          </span>
        )}
      </button>
    </div>}
  </div>;
}
