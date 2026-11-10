import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export function Tooltip({
  label,
  children,
  className = "",
  enabled = true,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  enabled?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const id = useId();

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPosition(null);
  };

  const show = () => {
    if (!enabled || !label) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) {
        const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const top = rect.top / zoom;
        setPosition({
          x: (rect.left + rect.width / 2) / zoom,
          y: top < 48 ? rect.bottom / zoom + 9 : top - 9,
          below: top < 48,
        });
      }
    }, 450);
  };

  useEffect(() => {
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!position || !tooltipRef.current) return;
    const tooltip = tooltipRef.current;
    const width = tooltip.offsetWidth;
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const center = Math.max(width / 2 + 8, Math.min(window.innerWidth / zoom - width / 2 - 8, position.x));
    tooltip.style.left = `${center}px`;
    tooltip.style.setProperty("--tooltip-arrow-x", `${Math.max(12, Math.min(width - 12, position.x - center + width / 2))}px`);
  }, [position]);

  if (!enabled || !label) {
    return <>{children}</>;
  }

  const portal = position
    ? createPortal(
        <span
          id={id}
          ref={tooltipRef}
          data-below={position.below}
          role="tooltip"
          className="shared-tooltip"
          style={{
            left: position.x,
            top: position.y,
            transform: `translate(-50%, ${position.below ? "0" : "-100%"})`,
          }}
        >
          {label}
        </span>,
        document.body
      )
    : null;

  if (isValidElement(children) && !className) {
    const child = children as ReactElement<any>;
    return (
      <>
        {cloneElement(child, {
          ref: (node: HTMLElement | null) => {
            (ref as any).current = node;
            const childRef = child.props.ref;
            if (typeof childRef === "function") childRef(node);
            else if (childRef && typeof childRef === "object") childRef.current = node;
          },
          onPointerEnter: (event: any) => {
            child.props.onPointerEnter?.(event);
            if (event.pointerType !== "touch") show();
          },
          onPointerLeave: (event: any) => {
            child.props.onPointerLeave?.(event);
            hide();
          },
          onPointerDown: (event: any) => {
            child.props.onPointerDown?.(event);
            hide();
          },
          onBlur: (event: any) => {
            child.props.onBlur?.(event);
            hide();
          },
          onClick: (event: any) => {
            child.props.onClick?.(event);
            hide();
          },
          "aria-describedby": position ? id : child.props["aria-describedby"],
        })}
        {portal}
      </>
    );
  }

  return (
    <span
      ref={ref as any}
      className={`tooltip-trigger ${className}`}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") show();
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onBlur={hide}
      onClick={hide}
      aria-describedby={position ? id : undefined}
    >
      {children}
      {portal}
    </span>
  );
}
