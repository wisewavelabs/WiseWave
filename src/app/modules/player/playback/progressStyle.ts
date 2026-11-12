export const PROGRESS_STYLES = ["Default", "Slim", "Wavy", "Squiggly"] as const;
export type ProgressStyle = (typeof PROGRESS_STYLES)[number];

export function readProgressStyle(value?: string | null): ProgressStyle {
  return PROGRESS_STYLES.includes(value as ProgressStyle) ? (value as ProgressStyle) : "Default";
}

export function progressStyleFromSettings(): ProgressStyle {
  try {
    const parsed = JSON.parse(localStorage.getItem("wisewave-settings") || "{}");
    return readProgressStyle(parsed.progressStyle);
  } catch {
    return "Default";
  }
}
