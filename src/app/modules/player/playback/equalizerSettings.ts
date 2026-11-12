export const EQ_BANDS = [60, 150, 400, 1000, 2400, 15000] as const;
export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0],
  "Bass boost": [4, 3, 1, 0, 0, 0],
  Vocal: [-1, -1, 0, 2, 3, 1],
  "Treble boost": [0, 0, 0, 0, 2, 4],
  Acoustic: [2, 1, 0, 0, 1, 2],
};

export type EqualizerSettings = { enabled: boolean; gains: number[] };
const KEY = "wisewave-equalizer";

export function readEqualizer(): EqualizerSettings {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    if (typeof value?.enabled === "boolean" && Array.isArray(value.gains) && value.gains.length === EQ_BANDS.length && value.gains.every((gain: unknown) => typeof gain === "number" && Number.isFinite(gain) && gain >= -12 && gain <= 12)) return value;
  } catch {}
  return { enabled: false, gains: [...EQ_PRESETS.Flat] };
}

export function saveEqualizer(value: EqualizerSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch {}
  window.dispatchEvent(new CustomEvent("wisewave-equalizer-changed", { detail: value }));
}
