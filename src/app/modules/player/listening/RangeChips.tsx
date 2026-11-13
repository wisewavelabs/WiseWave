import type { ListeningRange } from "./types";

const RANGES: { id: ListeningRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
  { id: "month", label: "This Month" },
  { id: "year", label: "This Year" },
  { id: "all", label: "All Time" },
];

export function RangeChips({ value, onChange }: { value: ListeningRange; onChange: (range: ListeningRange) => void }) {
  return (
    <div className="listening-ranges" role="radiogroup" aria-label="Listening period">
      {RANGES.map((range) => (
        <button
          key={range.id}
          className={`listening-range${value === range.id ? " is-active active" : ""}`}
          type="button"
          role="radio"
          aria-checked={value === range.id}
          onClick={() => onChange(range.id)}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
