import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export const shortcutGroups = [
  { title: "Playback", rows: [["Play or pause", "Space"], ["Previous song", "Ctrl", "←"], ["Next song", "Ctrl", "→"], ["Back 10 seconds", "Shift", "←"], ["Forward 10 seconds", "Shift", "→"], ["Repeat", "Alt", "R"]] },
  { title: "Sound", rows: [["Volume up", "Alt", "↑"], ["Volume down", "Alt", "↓"], ["Mute or restore", "Ctrl", "M"]] },
  { title: "View", rows: [["Search", "Ctrl", "K"], ["Lyrics", "Alt", "L"], ["Miniplayer", "Alt", "M"]] },
];

export function Shortcuts({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    const siblings = Array.from(dialog.current?.parentElement?.parentElement?.children || []).filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(dialog.current));
    const states = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    return () => { siblings.forEach((element, index) => { element.inert = states[index]; }); previous?.focus(); };
  }, []);
  return <div className="shortcuts-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div className="shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" aria-describedby="shortcuts-description" tabIndex={-1} ref={dialog} onKeyDown={(event) => { if (event.key === "Tab") { event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>("button")?.focus(); } }}><header><div className="shortcuts-heading"><h1 id="shortcuts-title">Keyboard shortcuts</h1><button type="button" aria-label="Close keyboard shortcuts" onClick={close}><X size={18} /></button></div><p id="shortcuts-description" className="shortcuts-intro"><span>Press</span><span><kbd>Ctrl</kbd><kbd>/</kbd></span><span>to toggle this modal.</span></p></header><div className="shortcuts-body">{shortcutGroups.map((group) => <section key={group.title}><h2>{group.title}</h2>{group.rows.map(([label, ...keys]) => <div className="shortcut-row" key={label}><span>{label}</span><span>{keys.map((key) => <kbd key={key}>{key}</kbd>)}</span></div>)}</section>)}</div></div></div>;
}
