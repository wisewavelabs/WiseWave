import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type SnackbarSpec = { key?: string; text: string; duration?: number; progress?: number | null; progressLabel?: string; accent?: string; action?: { label: string; onClick: () => void }; onDismiss?: () => void };
type SnackbarItem = SnackbarSpec & { id: number; slot: string };
const SnackbarContext = createContext<((spec: SnackbarSpec) => void) | null>(null);

function ProgressBorder({ value, accent }: { value: number | null; accent?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const parent = svg.current?.parentElement;
    if (!parent) return;
    const resize = () => setSize({ width: parent.clientWidth, height: parent.clientHeight });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const w = Math.max(8, size.width), h = Math.max(8, size.height);
  const path = `M4 1 H${w - 4} A3 3 0 0 1 ${w - 1} 4 V${h - 4} A3 3 0 0 1 ${w - 4} ${h - 1} H4 A3 3 0 0 1 1 ${h - 4} V4 A3 3 0 0 1 4 1`;
  return <svg className="snackbar-progress-border" ref={svg} width="100%" height="100%" aria-hidden="true"><path d={path} className="snackbar-progress-track" /><path d={path} className="snackbar-progress-fill" pathLength={100} stroke={accent || "#f1f1f1"} strokeDasharray="100" strokeDashoffset={100 - Math.max(0, Math.min(1, value ?? 0)) * 100} /></svg>;
}

function SnackbarToast({ item, remove }: { item: SnackbarItem; remove: (slot: string, id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const timer = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const dismissing = useRef(false);
  const dismiss = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true; setLeaving(true);
    const reduced = document.documentElement.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timer.current = window.setTimeout(() => remove(item.slot, item.id), reduced ? 0 : 200);
  }, [item.slot, item.id, remove]);
  useEffect(() => {
    if (item.duration === -2) return;
    const timeout = window.setTimeout(dismiss, item.duration && item.duration > 0 ? item.duration : 2750);
    return () => window.clearTimeout(timeout);
  }, [item.duration, item.text, dismiss]);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const hasProgress = item.progress !== undefined;
  return <div className="snackbar-slot" onPointerDown={(event) => { if ((event.target as Element).closest("button")) return; startX.current = event.clientX; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (startX.current !== null) setOffset(event.clientX - startX.current); }} onPointerUp={(event) => { if (startX.current === null) return; const moved = event.clientX - startX.current; startX.current = null; setDragging(false); if (Math.abs(moved) > event.currentTarget.offsetWidth * 0.4) dismiss(); else setOffset(0); }} onPointerCancel={() => { startX.current = null; setDragging(false); setOffset(0); }} style={{ transform: `translateX(${offset}px)`, opacity: Math.max(0, 1 - Math.abs(offset) / 320), transition: dragging ? "none" : "transform 150ms, opacity 150ms" }}>
    <div className="snackbar" data-leaving={leaving || undefined} role="status" aria-live={item.duration === -2 ? "off" : "polite"}>
      {hasProgress && <ProgressBorder value={item.progress ?? null} accent={item.accent} />}
      <span className="snackbar-text"><span>{item.text}</span>{hasProgress && <span className="snackbar-progress-meta" role="progressbar" aria-label={item.text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress == null ? undefined : Math.round(item.progress * 100)} aria-valuetext={item.progressLabel}>{item.progressLabel}</span>}</span>
      {item.action && <button type="button" className="snackbar-action" onClick={() => { item.action?.onClick(); dismiss(); }}>{item.action.label}</button>}
      <button type="button" className="snackbar-close" aria-label="Dismiss" onClick={dismiss}><X size={20} /></button>
    </div>
  </div>;
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<SnackbarItem[]>([]);
  const current = useRef(new Map<string, SnackbarItem>());
  const nextId = useRef(0);
  const show = useCallback((spec: SnackbarSpec) => {
    const slot = spec.key || "notification";
    const previous = current.current.get(slot);
    const next = { ...spec, slot, id: spec.key && previous ? previous.id : ++nextId.current };
    current.current.set(slot, next);
    setItems(Array.from(current.current.values()));
    if (!spec.key) previous?.onDismiss?.();
  }, []);
  const remove = useCallback((slot: string, id: number) => {
    const target = current.current.get(slot);
    if (target?.id !== id) return;
    current.current.delete(slot); setItems(Array.from(current.current.values())); target.onDismiss?.();
  }, []);
  return <SnackbarContext.Provider value={show}>{children}{createPortal(<div className="snackbar-host">{items.map((item) => <SnackbarToast key={item.id} item={item} remove={remove} />)}</div>, document.body)}</SnackbarContext.Provider>;
}

export function useSnackbar() {
  const show = useContext(SnackbarContext);
  if (!show) throw new Error("SnackbarProvider is required");
  return show;
}
