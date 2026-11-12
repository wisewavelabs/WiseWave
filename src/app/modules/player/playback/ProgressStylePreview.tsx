import { useEffect, useRef } from "react";
import type { ProgressStyle } from "./progressStyle";

function paint(
  canvas: HTMLCanvasElement,
  style: ProgressStyle,
  progress: number,
  buffered: number,
  phase: number,
  thumbRadius = 8,
) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 2 || height < 2) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const wavy = style === "Wavy" || style === "Squiggly";
  const bar = style === "Default" ? 10 : 4;
  const top = (height - bar) / 2;
  const end = width * Math.min(1, Math.max(0, progress));
  const bufferedEnd = width * Math.min(1, Math.max(0, buffered));
  const trackStart = wavy ? end : 0;

  ctx.fillStyle = "rgba(255,255,255,0.18)";
  if (trackStart < width) {
    roundRect(ctx, trackStart, top, width - trackStart, bar, bar / 2);
    ctx.fill();
  }

  if (bufferedEnd > trackStart) {
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    roundRect(ctx, trackStart, top, bufferedEnd - trackStart, bar, bar / 2);
    ctx.fill();
  }

  if (end > 0) {
    if (wavy) {
      const wavelength = style === "Squiggly" ? 22 : 38;
      const amplitude = style === "Squiggly" ? 5 : 3;
      ctx.beginPath();
      for (let x = 0; x <= end; x += 2) {
        const y = height / 2 + amplitude * Math.min(x / 10, 1) * Math.sin((x / wavelength) * Math.PI * 2 + phase);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(end, height / 2 + amplitude * Math.min(end / 10, 1) * Math.sin((end / wavelength) * Math.PI * 2 + phase));
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = bar;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      roundRect(ctx, 0, top, end, bar, bar / 2);
      ctx.fill();
    }
  }

  ctx.beginPath();
  ctx.fillStyle = "#fff";
  ctx.arc(end, height / 2, thumbRadius, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function ProgressStylePreview({
  style,
  progress = 0.62,
  buffered = 0.85,
  playing = true,
  className = "",
}: {
  style: ProgressStyle;
  progress?: number;
  buffered?: number;
  playing?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = document.documentElement.dataset.motion === "reduce"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wavy = style === "Wavy" || style === "Squiggly";
    let frame = 0;
    let phase = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      if (playing && !reduce) {
        if (wavy) phase = (phase + dt * Math.PI * 2 / 1800) % (Math.PI * 2);
      }
      paint(canvas, style, progressRef.current, buffered, phase);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [style, buffered, playing]);

  return <canvas ref={ref} className={`progress-style-preview ${className}`} aria-hidden="true" />;
}

export function paintSeekWave(
  canvas: HTMLCanvasElement,
  style: ProgressStyle,
  progress: number,
  buffered: number,
  phase: number,
) {
  paint(canvas, style, progress, buffered, phase, 6);
}
