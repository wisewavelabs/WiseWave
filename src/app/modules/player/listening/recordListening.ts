export type ListenSample = {
  trackId: string;
  positionSec: number;
  playing: boolean;
};

export type ListenAccumulator = {
  attemptId: string;
  trackId: string;
  listenedSec: number;
  startedAtMs: number;
  lastHeartbeatAt: number;
  sentSec: number;
  sample: ListenSample | null;
};

const MAX_DELTA_SEC = 2;
export const HEARTBEAT_EVERY_MS = 5000;
const ATTEMPT_KEY = "wisewave-listening-attempt";

type StoredAttempt = {
  attemptId: string;
  trackId: string;
  startedAtMs: number;
  listenedSec: number;
};

export function newAttemptId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readStoredAttempt(): StoredAttempt | null {
  try {
    const raw = localStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredAttempt>;
    if (typeof value.attemptId !== "string" || !value.attemptId) return null;
    if (typeof value.trackId !== "string" || !value.trackId) return null;
    if (typeof value.startedAtMs !== "number" || !Number.isFinite(value.startedAtMs) || value.startedAtMs <= 0) return null;
    return {
      attemptId: value.attemptId,
      trackId: value.trackId,
      startedAtMs: value.startedAtMs,
      listenedSec: typeof value.listenedSec === "number" && Number.isFinite(value.listenedSec) ? Math.max(0, value.listenedSec) : 0,
    };
  } catch {
    return null;
  }
}

export function persistListeningAttempt(acc: ListenAccumulator): void {
  if (!acc.trackId || !acc.attemptId) {
    clearListeningAttempt();
    return;
  }
  try {
    const payload: StoredAttempt = {
      attemptId: acc.attemptId,
      trackId: acc.trackId,
      startedAtMs: acc.startedAtMs,
      listenedSec: acc.listenedSec,
    };
    localStorage.setItem(ATTEMPT_KEY, JSON.stringify(payload));
  } catch {}
}

export function clearListeningAttempt(): void {
  try { localStorage.removeItem(ATTEMPT_KEY); }
  catch {}
}

export function createAccumulator(trackId: string, now = Date.now()): ListenAccumulator {
  if (!trackId) {
    clearListeningAttempt();
    return { attemptId: "", trackId: "", listenedSec: 0, startedAtMs: 0, lastHeartbeatAt: 0, sentSec: 0, sample: null };
  }
  const stored = readStoredAttempt();
  if (stored && stored.trackId === trackId) {
    return {
      attemptId: stored.attemptId,
      trackId,
      listenedSec: stored.listenedSec,
      startedAtMs: stored.startedAtMs || now,
      lastHeartbeatAt: 0,
      sentSec: stored.listenedSec,
      sample: null,
    };
  }
  const next: ListenAccumulator = {
    attemptId: newAttemptId(),
    trackId,
    listenedSec: 0,
    startedAtMs: now,
    lastHeartbeatAt: 0,
    sentSec: 0,
    sample: null,
  };
  persistListeningAttempt(next);
  return next;
}

export function accumulateListen(
  acc: ListenAccumulator,
  opts: {
    trackId: string;
    positionSec: number;
    intendedPlaying: boolean;
    statePlaying: boolean;
    buffering: boolean;
  },
): ListenAccumulator {
  if (!opts.trackId || !Number.isFinite(opts.positionSec)) return acc;
  if (opts.trackId !== acc.trackId) {
    return createAccumulator(opts.trackId);
  }
  const next = { ...acc };
  if (!next.attemptId) next.attemptId = newAttemptId();
  const canCredit = opts.intendedPlaying && opts.statePlaying && !opts.buffering;
  const sample = acc.sample;
  if (!sample || sample.trackId !== opts.trackId) {
    next.sample = { trackId: opts.trackId, positionSec: opts.positionSec, playing: canCredit };
    return next;
  }
  if (!canCredit || !sample.playing) {
    next.sample = { trackId: opts.trackId, positionSec: opts.positionSec, playing: canCredit };
    return next;
  }
  const raw = opts.positionSec - sample.positionSec;
  if (raw < 0) {
    next.sample = { trackId: opts.trackId, positionSec: opts.positionSec, playing: true };
    return next;
  }
  if (raw > 0 && raw <= MAX_DELTA_SEC) {
    next.listenedSec += raw;
  }
  next.sample = { trackId: opts.trackId, positionSec: opts.positionSec, playing: true };
  return next;
}

export function shouldHeartbeat(acc: ListenAccumulator, now = Date.now()): boolean {
  if (acc.listenedSec <= acc.sentSec + 0.05) return false;
  const anchor = acc.lastHeartbeatAt || acc.startedAtMs;
  return anchor <= 0 || now - anchor >= HEARTBEAT_EVERY_MS;
}

export function markHeartbeat(acc: ListenAccumulator, now = Date.now()): ListenAccumulator {
  const next = { ...acc, lastHeartbeatAt: now, sentSec: acc.listenedSec };
  persistListeningAttempt(next);
  return next;
}

export function getListeningTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
