export function PlayingSpectrum({
  active,
  playing,
  size = 32,
  placement = "center",
  className = "",
}: {
  active: boolean;
  playing: boolean;
  size?: number;
  placement?: "center" | "corner";
  className?: string;
}) {
  if (!active) return null;
  return (
    <span
      className={`playing-spectrum playing-spectrum--${placement}${playing ? " is-playing" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size, ["--spectrum-size" as string]: `${size}px` }}
      aria-hidden="true"
    >
      <span className="playing-spectrum-bars">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}
