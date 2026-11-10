import type { ComponentProps } from "react";

type ClassicProps = Omit<ComponentProps<"span">, "children">;

function Classic({ className, ...props }: ClassicProps) {
  return (
    <>
      <style>{`
        @keyframes loading-ui-classic-fade {
          0% {
            opacity: 1;
          }

          100% {
            opacity: 0.15;
          }
        }
      `}</style>
      <span
        role="status"
        className={`classic ${className || ""}`}
        {...props}
      >
        <span
          aria-hidden="true"
          className="classic-spokes"
        >
          {Array.from({ length: 12 }, (_, index) => (
            <span
              key={index}
              className="classic-spoke"
              style={{
                transform: `rotate(${index * 30}deg) translate(146%)`,
                animation:
                  "loading-ui-classic-fade var(--duration, 1.2s) linear infinite",
                animationDelay: `calc(var(--duration, 1.2s) / 12 * ${index - 12})`,
              }}
            />
          ))}
        </span>
        <span className="classic-label">Loading</span>
      </span>
    </>
  );
}

export { Classic };
