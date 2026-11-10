import { useCallback, useEffect, useRef, useState } from "react";

export function ResizeHandle({ invert = false, label, max, min, onChange, onDraggingChange, value }: {
  invert?: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (width: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
  value: number;
}) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ width: 0, x: 0 });

  const move = useCallback((event: PointerEvent) => {
    const delta = event.clientX - startRef.current.x;
    onChange(Math.min(max, Math.max(min, startRef.current.width + (invert ? -delta : delta))));
  }, [invert, max, min, onChange]);

  useEffect(() => {
    if (!dragging) return;
    const stop = () => {
      setDragging(false);
      onDraggingChange?.(false);
    };
    const cursor = document.body.style.cursor;
    const selection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = selection;
      onDraggingChange?.(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging, move, onDraggingChange]);

  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={Math.round(value)}
      className="resize-handle"
      role="separator"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        onChange(Math.min(max, Math.max(min, value + (invert ? -direction : direction) * (event.shiftKey ? 24 : 8))));
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        startRef.current = { width: value, x: event.clientX };
        onDraggingChange?.(true);
        setDragging(true);
      }}
    />
  );
}
