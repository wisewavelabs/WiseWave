import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type SnackbarSpec = { text: string; duration?: number; action?: { label: string; onClick: () => void }; onDismiss?: () => void };
type SnackbarItem = SnackbarSpec & { id: number };
const SnackbarContext = createContext<((spec: SnackbarSpec) => void) | null>(null);

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<SnackbarItem | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const current = useRef<SnackbarItem | null>(null);
  const nextId = useRef(0);
  const exitTimer = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const dismissing = useRef(false);
  const show = useCallback((spec: SnackbarSpec) => {
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
    current.current?.onDismiss?.();
    const next = { ...spec, id: ++nextId.current };
    current.current = next;
    dismissing.current = false;
    startX.current = null;
    setLeaving(false);
    setOffset(0);
    setDragging(false);
    setItem(next);
  }, []);
  const dismiss = useCallback(() => {
    const target = current.current;
    if (!target || dismissing.current) return;
    dismissing.current = true;
    setLeaving(true);
    const reduced = document.documentElement.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    exitTimer.current = window.setTimeout(() => {
      if (current.current?.id !== target.id) return;
      current.current = null;
      setItem(null);
      dismissing.current = false;
      target.onDismiss?.();
    }, reduced ? 0 : 200);
  }, []);
  useEffect(() => {
    if (!item || item.duration === -2) return;
    const timer = window.setTimeout(dismiss, item.duration && item.duration > 0 ? item.duration : 2750);
    return () => window.clearTimeout(timer);
  }, [item, dismiss]);
  useEffect(() => () => { if (exitTimer.current !== null) window.clearTimeout(exitTimer.current); }, []);
  return <SnackbarContext.Provider value={show}>{children}{createPortal(<div className="snackbar-host" role="status" aria-live="polite" aria-atomic="true">
    {item && <div className="snackbar-slot" onPointerDown={(event) => { if ((event.target as Element).closest("button")) return; startX.current = event.clientX; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (startX.current !== null) setOffset(event.clientX - startX.current); }} onPointerUp={(event) => { if (startX.current === null) return; const moved = event.clientX - startX.current; startX.current = null; setDragging(false); if (Math.abs(moved) > event.currentTarget.offsetWidth * 0.4) dismiss(); else setOffset(0); }} onPointerCancel={() => { startX.current = null; setDragging(false); setOffset(0); }} style={{ transform: `translateX(${offset}px)`, opacity: Math.max(0, 1 - Math.abs(offset) / 320), transition: dragging ? "none" : "transform 150ms, opacity 150ms" }}>
      <div key={item.id} className="snackbar" data-leaving={leaving || undefined}><span className="snackbar-text">{item.text}</span>{item.action && <button type="button" className="snackbar-action" onClick={() => { item.action?.onClick(); dismiss(); }}>{item.action.label}</button>}<button type="button" className="snackbar-close" aria-label="Dismiss" onClick={dismiss}><X size={20} /></button></div>
    </div>}
  </div>, document.body)}</SnackbarContext.Provider>;
}

export function useSnackbar() {
  const show = useContext(SnackbarContext);
  if (!show) throw new Error("SnackbarProvider is required");
  return show;
}
