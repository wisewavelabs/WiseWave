import { useCallback, useEffect, useRef, useState } from "react";

export function PlayerSlider({ animateValue = false, bufferedValue = 0, className = "", disabled = false, dimWhenDisabled = true, label, max, onChange, onCommit, tooltip, tooltipMode = "hover", value, visibleValue = null }: {
  animateValue?: boolean;
  bufferedValue?: number;
  className?: string;
  disabled?: boolean;
  dimWhenDisabled?: boolean;
  label: string;
  max: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  tooltip?: (value: number) => string;
  tooltipMode?: "drag" | "hover";
  value: number;
  visibleValue?: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latestValueRef = useRef(value);
  const [dragging, setDragging] = useState(false);
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const percentage = max > 0 ? Math.min(100, Math.max(0, value / max * 100)) : 0;

  const resolveValueFromClientX = useCallback((clientX: number) => {
    if (disabled || !ref.current) return null;
    const rectangle = ref.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rectangle.left) / rectangle.width)) * max;
  }, [disabled, max]);

  const setFromClientX = useCallback((clientX: number) => {
    const nextValue = resolveValueFromClientX(clientX);
    if (nextValue === null) return;
    latestValueRef.current = nextValue;
    setHoverValue(nextValue);
    onChange(nextValue);
  }, [onChange, resolveValueFromClientX]);

  useEffect(() => {
    if (!dragging) latestValueRef.current = value;
  }, [dragging, value]);

  const tooltipValue = hoverValue ?? visibleValue;
  const displayedTooltipValue = tooltipValue ?? value;
  const tooltipPercentage = max > 0 ? Math.min(100, Math.max(0, displayedTooltipValue / max * 100)) : 0;
  const shortcutTooltipVisible = hoverValue === null && visibleValue !== null;

  return (
    <div
      aria-label={label}
      aria-disabled={disabled}
      aria-valuemax={Math.round(max)}
      aria-valuemin={0}
      aria-valuenow={Math.round(value)}
      aria-valuetext={tooltip?.(value)}
      className={`player-slider ${disabled && dimWhenDisabled ? "slider-disabled" : ""} ${animateValue && !dragging ? "slider-animate" : ""} ${className}`}
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (disabled || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
        event.preventDefault();
        const nextValue = event.key === "ArrowRight" ? Math.min(max, value + max * .05) : Math.max(0, value - max * .05);
        latestValueRef.current = nextValue;
        onChange(nextValue);
      }}
      onKeyUp={(event) => {
        if (!disabled && (event.key === "ArrowRight" || event.key === "ArrowLeft")) onCommit?.(latestValueRef.current);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        setFromClientX(event.clientX);
      }}
      onPointerMove={(event) => {
        if (disabled) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          setFromClientX(event.clientX);
          return;
        }
        if (tooltipMode === "hover") setHoverValue(resolveValueFromClientX(event.clientX));
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
        const finalValue = resolveValueFromClientX(event.clientX) ?? latestValueRef.current;
        latestValueRef.current = finalValue;
        onChange(finalValue);
        const rectangle = event.currentTarget.getBoundingClientRect();
        const inside = event.clientX >= rectangle.left && event.clientX <= rectangle.right && event.clientY >= rectangle.top && event.clientY <= rectangle.bottom;
        setHoverValue(tooltipMode === "hover" && inside ? resolveValueFromClientX(event.clientX) : null);
        onCommit?.(finalValue);
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
        setHoverValue(null);
        onCommit?.(latestValueRef.current);
      }}
      onPointerLeave={() => {
        if (!dragging && tooltipMode === "hover") setHoverValue(null);
      }}
    >
      <div className="slider-track"><div className="slider-buffer" style={{ width: `${max > 0 ? Math.min(100, Math.max(0, bufferedValue / max * 100)) : 0}%` }} /><div className="slider-fill" style={{ width: `${percentage}%` }} /></div>
      <span className="slider-thumb" style={{ left: `${percentage}%`, opacity: dragging ? 1 : undefined }} />
      {tooltip && !disabled && <span aria-hidden={tooltipValue === null} className={`slider-tooltip ${tooltipValue === null ? "" : "visible"} ${shortcutTooltipVisible ? "slider-tooltip-shortcut" : ""}`} role="tooltip" style={{ left: `${tooltipPercentage}%` }}>{tooltip(displayedTooltipValue)}<span className="slider-tooltip-arrow" /></span>}
    </div>
  );
}
