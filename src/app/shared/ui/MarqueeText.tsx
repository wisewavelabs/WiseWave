import type { CSSProperties, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";

export interface MarqueeTextProps {
  children?: ReactNode;
  className?: string;
  title?: string;
  speed?: number;
}

export function MarqueeText({ children, className = "", title, speed }: MarqueeTextProps) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const measure = () => setOverflow(Math.max(0, content.scrollWidth - viewport.clientWidth));
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    measure();

    return () => observer.disconnect();
  }, [children, overflow > 1]);

  const duration = speed ? Math.max(6, 3 + overflow / speed) : Math.min(36, Math.max(18, 15 + overflow / 12));
  const autoTitle = title ?? (typeof children === "string" ? children : undefined);

  return (
    <Tooltip label={autoTitle || ""} enabled={overflow > 1 && Boolean(autoTitle)}>
      <span
        className={`player-marquee ${overflow > 1 ? "player-marquee-active" : ""} ${className}`}
        ref={viewportRef}
      >
        <span
          className="player-marquee-content"
          ref={contentRef}
          style={{
            "--player-marquee-distance": `${-overflow}px`,
            "--player-marquee-duration": `${duration}s`,
          } as CSSProperties}
        >
          {children}
        </span>
      </span>
    </Tooltip>
  );
}
