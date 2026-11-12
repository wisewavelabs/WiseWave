import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { paintSeekWave } from "./ProgressStylePreview";
import { readProgressStyle, type ProgressStyle } from "./progressStyle";

export function PlayerSlider({
  animateValue = false,
  bufferedValue = 0,
  className = "",
  disabled = false,
  dimWhenDisabled = true,
  label,
  max,
  onChange,
  onCommit,
  tooltip,
  tooltipMode = "hover",
  value,
  visibleValue = null,
  progressStyle,
  playing = false,
}: {
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
  progressStyle?: ProgressStyle | string | null;
  playing?: boolean;
}) {
  const timeline = progressStyle != null && progressStyle !== "";
  const style = timeline ? readProgressStyle(progressStyle) : null;
  const wavy = style === "Wavy" || style === "Squiggly";
  const ref = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const wakeWave = useRef<() => void>(() => {});
  const waveState = useRef({ value, bufferedValue, max, playing, dragging: false });
  const latestValueRef = useRef(value);
  const [dragging, setDragging] = useState(false);
  waveState.current = { value, bufferedValue, max, playing, dragging };
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const percentage = max > 0 ? Math.min(100, Math.max(0, value / max * 100)) : 0;
  const bufferPercentage = max > 0 ? Math.min(100, Math.max(0, bufferedValue / max * 100)) : 0;

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

  useEffect(() => {
    if (!wavy) return;
    const canvas = waveRef.current;
    if (!canvas) return;
    const reduce = document.documentElement.dataset.motion === "reduce"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let phase = 0;
    let last = performance.now();
    let shown = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    let from = shown;
    let target = shown;
    let changedAt = last;
    const draw = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      const dt = Math.min(48, now - last);
      last = now;
      const current = waveState.current;
      if (current.playing && !current.dragging && !reduce) phase = (phase + dt * Math.PI * 2 / 1800) % (Math.PI * 2);
      const progress = current.max > 0 ? Math.min(1, Math.max(0, current.value / current.max)) : 0;
      if (progress !== target) {
        from = shown;
        target = progress;
        changedAt = now;
      }
      const t = current.dragging || reduce ? 1 : Math.min(1, (now - changedAt) / 300);
      shown = from + (target - from) * (1 - (1 - t) ** 2);
      const buffered = current.max > 0 ? Math.min(1, Math.max(0, current.bufferedValue / current.max)) : 0;
      if (style) paintSeekWave(canvas, style, shown, buffered, phase);
      if (!reduce && !current.dragging && (current.playing || t < 1)) frame = requestAnimationFrame(draw);
    };
    const wake = () => {
      if (frame || document.hidden) return;
      last = performance.now();
      frame = requestAnimationFrame(draw);
    };
    wakeWave.current = wake;
    const observer = new ResizeObserver(wake);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", wake);
    wake();
    return () => { wakeWave.current = () => {}; observer.disconnect(); document.removeEventListener("visibilitychange", wake); cancelAnimationFrame(frame); };
  }, [wavy, style]);

  useEffect(() => { if (wavy) wakeWave.current(); }, [wavy, value, bufferedValue, max, playing, dragging]);

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
      className={`player-slider${style ? ` seek-style-${style.toLowerCase()}` : ""} ${disabled && dimWhenDisabled ? "slider-disabled" : ""} ${animateValue && !dragging ? "slider-animate" : ""} ${className}`}
      data-progress-style={style || undefined}
      data-dragging={dragging || undefined}
      ref={ref}
      role="slider"
      style={{ "--slider-progress": `${percentage}%` } as CSSProperties}
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
      {wavy ? (
        <canvas ref={waveRef} className="slider-wave-canvas" aria-hidden="true" />
      ) : (
        <div className="slider-track">
          <div className="slider-buffer" style={{ width: `${bufferPercentage}%` }} />
          <div className="slider-fill" style={{ width: `${percentage}%` }} />
        </div>
      )}
      {!wavy && <span className="slider-thumb" style={{ left: `${percentage}%`, opacity: dragging ? 1 : undefined }} />}
      {tooltip && !disabled && (
        <span
          aria-hidden={tooltipValue === null}
          className={`slider-tooltip ${tooltipValue === null ? "" : "visible"} ${shortcutTooltipVisible ? "slider-tooltip-shortcut" : ""}`}
          role="tooltip"
          style={{ left: `${tooltipPercentage}%` }}
        >
          {tooltip(displayedTooltipValue)}
          <span className="slider-tooltip-arrow" />
        </span>
      )}
    </div>
  );
}
