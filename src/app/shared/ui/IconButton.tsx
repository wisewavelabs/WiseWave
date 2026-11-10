import type { ReactNode, Ref } from "react";
import { Tooltip } from "./Tooltip";

export function IconButton({ label, children, disabled = false, active, buttonRef, onClick }: { label: string; children: ReactNode; disabled?: boolean; active?: boolean; buttonRef?: Ref<HTMLButtonElement>; onClick?: () => void }) {
  return <Tooltip label={label}><button ref={buttonRef} className={`icon-button ${active ? "active-control" : ""}`} type="button" aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} onPointerDown={(event) => event.preventDefault()}>{children}</button></Tooltip>;
}
