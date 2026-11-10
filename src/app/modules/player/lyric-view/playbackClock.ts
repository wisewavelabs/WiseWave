const MAX_INTERPOLATION_MS = 1500;
const CORRECTION_DURATION_MS = 180;
const MAX_SMOOTH_DRIFT_MS = 120;

export interface PlaybackClock {
  read: (now?: number) => number;
  isAdvancing: (now?: number) => boolean;
  isReady: () => boolean;
  update: (positionSec: number, durationSec: number, playing: boolean, trackId?: string, now?: number, seekVersion?: number) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPlaybackClock(): PlaybackClock {
  let positionMs = 0;
  let durationMs = 0;
  let receivedAt = 0;
  let correctionMs = 0;
  let correctionDurationMs = CORRECTION_DURATION_MS;
  let ready = false;
  let playing = false;
  let trackId: string | undefined;
  let lastSeekVersion = 0;
  const listeners = new Set<() => void>();

  const read = (now = performance.now()) => {
    const elapsed = ready && playing ? Math.min(MAX_INTERPOLATION_MS, Math.max(0, now - receivedAt)) : 0;
    const correction = correctionMs * Math.max(0, 1 - elapsed / correctionDurationMs);
    return Math.max(0, Math.min(positionMs + elapsed + correction, durationMs));
  };

  const isAdvancing = (now = performance.now()) => ready && playing && now - receivedAt < MAX_INTERPOLATION_MS && read(now) < durationMs;
  const notify = () => listeners.forEach(listener => listener());

  return {
    read,
    isAdvancing,
    isReady: () => ready,
    update(positionSec: number, durationSec: number, nextPlaying: boolean, nextTrackId?: string, now = performance.now(), seekVersion = 0) {
      const previousPosition = read(now);
      const nextPosition = Number.isFinite(positionSec) ? Math.max(0, positionSec * 1000) : 0;
      ready = Boolean(nextTrackId);
      playing = nextPlaying;
      durationMs = Number.isFinite(durationSec) && durationSec > 0 ? durationSec * 1000 : Infinity;
      const drift = previousPosition - nextPosition;
      correctionMs = trackId === nextTrackId && seekVersion === lastSeekVersion && ready && playing && Math.abs(drift) <= MAX_SMOOTH_DRIFT_MS ? drift : 0;
      correctionDurationMs = CORRECTION_DURATION_MS;
      trackId = nextTrackId;
      lastSeekVersion = seekVersion;
      positionMs = ready ? nextPosition : 0;
      receivedAt = now;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

