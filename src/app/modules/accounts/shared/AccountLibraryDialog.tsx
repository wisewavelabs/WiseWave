import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function AccountLibraryDialog({ open, closing = false, title, provider, onClose, children }: { open: boolean; closing?: boolean; title: string; provider: "spotify" | "youtube"; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') || []).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); panel.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); if (previous?.isConnected) previous.focus(); };
  }, [open]);
  if (!open) return null;
  return createPortal(<div className={`account-sync-overlay${closing ? " closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`account-sync-modal account-provider-${provider}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>{children}</div>
  </div>, document.body);
}
