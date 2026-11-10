import type { Line } from "../../../mygo";
import type { LyricLine } from "../../../types/lyricRenderer";

export function normalizeLyricLines(rawLines: Line[]): LyricLine[] {
  const lines = rawLines.map((raw, index) => {
    const backgroundOnly = raw.syllables?.some(unit => unit.is_background)
      ? raw.syllables.every(unit => unit.is_background)
      : Boolean(raw.is_background);
    const timedBackground = backgroundOnly ? raw.syllables?.filter(unit => unit.end_time_ms > unit.start_time_ms) : undefined;
    const start = Math.max(0, timedBackground?.length ? Math.min(...timedBackground.map(unit => unit.start_time_ms)) : raw.start_time_ms);
    const nextStart = rawLines[index + 1]?.start_time_ms;
    const instrumental = !raw.text?.trim() || raw.text.trim() === "\u266a";
    const inferredEnd = nextStart > start && (instrumental || nextStart - start <= 6000) ? nextStart : start + 4500;
    const end = timedBackground?.length
      ? Math.max(...timedBackground.map(unit => unit.end_time_ms))
      : raw.end_time_ms > start ? raw.end_time_ms : raw.syllables?.at(-1)?.end_time_ms || inferredEnd;
    return {
      startTimeMs: start,
      endTimeMs: Math.max(start + 100, end),
      text: instrumental ? "" : raw.text,
      isBackground: backgroundOnly,
      transliteration: raw.transliteration,
      syllables: instrumental ? undefined : raw.syllables?.map((unit, unitIndex) => {
        const next = raw.syllables?.[unitIndex + 1]?.start_time_ms ?? 0;
        const unitEnd = unit.end_time_ms > unit.start_time_ms ? unit.end_time_ms : next > unit.start_time_ms ? next : unit.start_time_ms + 150;
        return {
          startTimeMs: unit.start_time_ms,
          endTimeMs: Math.max(unit.start_time_ms, Math.min(Math.max(unit.start_time_ms + 50, unitEnd), next > unit.start_time_ms ? next : Infinity, end > unit.start_time_ms ? end : Infinity)),
          text: unit.text,
          isBackground: unit.is_background,
          appendToPrevious: unit.append_to_previous,
        };
      }),
      accompanimentLines: [] as LyricLine[],
    };
  });
  const main = lines.filter(line => !line.isBackground);
  if (!main.length) return lines.map(line => ({ ...line, isBackground: false }));
  for (const line of lines) {
    if (line.isBackground) {
      const owner = main.reduce((best, candidate) => {
        const overlap = Math.max(0, Math.min(candidate.endTimeMs, line.endTimeMs) - Math.max(candidate.startTimeMs, line.startTimeMs));
        const bestOverlap = Math.max(0, Math.min(best.endTimeMs, line.endTimeMs) - Math.max(best.startTimeMs, line.startTimeMs));
        return overlap > bestOverlap || (overlap === bestOverlap && Math.abs(candidate.startTimeMs - line.startTimeMs) < Math.abs(best.startTimeMs - line.startTimeMs)) ? candidate : best;
      });
      owner.accompanimentLines.push(line);
      continue;
    }
    const background = line.syllables?.filter(unit => unit.isBackground) ?? [];
    const lead = line.syllables?.filter(unit => !unit.isBackground) ?? [];
    if (background.length && lead.length) {
      line.syllables = lead;
      line.accompanimentLines.push({
        startTimeMs: background[0].startTimeMs,
        endTimeMs: background.at(-1)!.endTimeMs,
        text: background.map(unit => unit.text).join(""),
        syllables: background,
        isBackground: true,
      });
    }
  }
  return main;
}
