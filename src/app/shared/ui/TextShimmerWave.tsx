import type React from "react";
import { type JSX, useMemo } from "react";

export type TextShimmerWaveProps = {
  children: string;
  as?: React.ElementType;
  className?: string;
  duration?: number;
  baseColor?: string;
  shimmerColor?: string;
  zDistance?: number;
  xDistance?: number;
  yDistance?: number;
  spread?: number;
  scaleDistance?: number;
  rotateYDistance?: number;
  transition?: any;
  style?: React.CSSProperties;
};

function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(" ");
}

export function TextShimmerWave({
  children,
  as: Component = "p",
  className,
  duration = 1.4,
  baseColor,
  shimmerColor,
  zDistance = 18,
  xDistance = 0,
  yDistance = -6,
  spread = 1.2,
  scaleDistance = 1.15,
  rotateYDistance = 0,
  style,
}: TextShimmerWaveProps): JSX.Element {
  const tokens = useMemo(() => {
    const parts = children.split(/(\s+)/);
    let charIndex = 0;
    return parts.map((part) => {
      const isSpace = /^\s+$/.test(part);
      const startIndex = charIndex;
      charIndex += part.length;
      return { part, isSpace, startIndex };
    });
  }, [children]);

  const totalLength = useMemo(() => Math.max(1, children.length), [children]);
  const repeatDelay = (totalLength * 0.05) / spread;
  const totalDuration = duration + repeatDelay;

  return (
    <Component
      className={cn("text-shimmer-wave relative", className)}
      style={
        {
          ...style,
          perspective: "500px",
          textAlign: "center",
          "--base-color":
            baseColor ?? "color-mix(in oklab, currentColor 55%, transparent)",
          "--base-gradient-color": shimmerColor ?? "currentColor",
          "--x-distance": `${xDistance}px`,
          "--y-distance": `${yDistance}px`,
          "--z-distance": `${zDistance}px`,
          "--scale-distance": scaleDistance,
          "--rotate-y-distance": `${rotateYDistance}deg`,
        } as React.CSSProperties
      }
    >
      <span
        className="sr-only"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {children}
      </span>
      {tokens.map((token) => {
        if (token.isSpace) {
          return (
            <span
              key={token.startIndex}
              aria-hidden="true"
              className="text-shimmer-wave-space inline"
              style={{ whiteSpace: "pre" }}
            >
              {token.part}
            </span>
          );
        }

        const chars = token.part.split("");
        return (
          <span
            key={token.startIndex}
            aria-hidden="true"
            className="text-shimmer-wave-word inline-block whitespace-nowrap"
            style={{
              display: "inline-block",
              whiteSpace: "nowrap",
              transformStyle: "preserve-3d",
            }}
          >
            {chars.map((char, offset) => {
              const i = token.startIndex + offset;
              const delay = (i * duration * (1 / spread)) / totalLength;

              return (
                <span
                  key={i}
                  className="text-shimmer-wave-char inline-block whitespace-pre"
                  style={{
                    display: "inline-block",
                    whiteSpace: "pre",
                    transformStyle: "preserve-3d",
                    animation: `text-shimmer-wave-anim ${totalDuration}s ease-in-out infinite`,
                    animationDelay: `${delay}s`,
                  }}
                >
                  {char}
                </span>
              );
            })}
          </span>
        );
      })}
    </Component>
  );
}

