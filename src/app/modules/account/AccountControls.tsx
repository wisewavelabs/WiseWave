import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, UserRound } from "lucide-react";

export function AccountControls() {
  const [open, setOpen] = useState<"notifications" | "profile" | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(null);
        container.current?.querySelector<HTMLButtonElement>(`[data-menu="${open}"]`)?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return <div className="account-controls" ref={container}>
    <div className="account-menu notification-menu">
      <button className="notification-trigger" type="button" aria-label="Notifications" aria-expanded={open === "notifications"} aria-controls="notifications-menu" data-menu="notifications" onClick={() => setOpen(open === "notifications" ? null : "notifications")}><Bell size={20} /></button>
      {open === "notifications" && <section className="account-dropdown notifications-dropdown" id="notifications-menu" aria-label="Notifications">
        <div className="notifications-heading">Notifications</div>
        <div className="notifications-empty">
          <div className="notification-illustration" aria-hidden="true"><div className="notification-card"><i /><span><b /><b /></span><small>now</small></div><div className="notification-card"><i /><span><b /><b /></span><small>now</small></div></div>
          <strong>Notifications unavailable</strong><p>Notifications aren’t connected yet.</p>
        </div>
      </section>}
    </div>
    <div className="account-menu profile-menu">
      <button className="profile-trigger" type="button" aria-label="Open account menu" aria-expanded={open === "profile"} aria-controls="profile-menu" data-menu="profile" onClick={() => setOpen(open === "profile" ? null : "profile")}><span className="profile-avatar"><UserRound size={19} /></span><span className="profile-name">Friston</span><ChevronDown className={open === "profile" ? "connection-chevron open" : "connection-chevron"} size={14} /></button>
      {open === "profile" && <section className="account-dropdown profile-dropdown" id="profile-menu" aria-label="Account">
        <div className="profile-heading"><span className="profile-avatar profile-avatar-large"><UserRound size={22} /></span><div><strong>Profile unavailable</strong><span>No account connected</span></div></div>
      </section>}
    </div>
  </div>;
}
