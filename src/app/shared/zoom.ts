export const ZOOM_LEVELS = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3] as const;
let currentZoom: number | null = null;

export function readZoom() {
  if (currentZoom !== null) return currentZoom;
  try {
    const saved = localStorage.getItem("wisewave-zoom");
    if (saved !== null) {
      const value = Number(saved);
      if ((ZOOM_LEVELS as readonly number[]).includes(value)) return value;
    }
    const settings = JSON.parse(localStorage.getItem("wisewave-settings") || "{}");
    if (settings.ui === "Compact") return 0.9;
    if (settings.ui === "Large") return 1.1;
  } catch {}
  return 1;
}

export function setZoom(value: number) {
  if (!(ZOOM_LEVELS as readonly number[]).includes(value)) return;
  currentZoom = value;
  document.documentElement.style.zoom = String(value);
  try { localStorage.setItem("wisewave-zoom", String(value)); } catch {}
  window.dispatchEvent(new CustomEvent("wisewave-zoom-changed", { detail: value }));
}

export function syncZoom(value: string | null) {
  const next = Number(value);
  if (value !== null && (ZOOM_LEVELS as readonly number[]).includes(next)) {
    currentZoom = next;
    document.documentElement.style.zoom = String(next);
    window.dispatchEvent(new CustomEvent("wisewave-zoom-changed", { detail: next }));
  }
}

export function stepZoom(direction: number) {
  const index = (ZOOM_LEVELS as readonly number[]).indexOf(readZoom());
  setZoom(ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + direction))]);
}
