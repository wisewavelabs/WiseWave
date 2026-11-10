import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Track } from "../../../mygo";
import { Artwork } from "../../../shared/ui/Artwork";
import { MarqueeText } from "../../../shared/ui/MarqueeText";

export function ArtworkViewer({ track, onClose }: { track: Track; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const close = () => {
    if (timer.current !== undefined) return;
    setClosing(true);
    timer.current = window.setTimeout(onClose, 150);
  };

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = closeButton.current?.closest(".artwork-viewer-overlay");
    const siblings = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay);
    const states = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    closeButton.current?.focus();
    return () => {
      window.clearTimeout(timer.current);
      siblings.forEach((element, index) => { element.inert = states[index]; });
      previous?.focus();
    };
  }, []);

  return createPortal(<div className={`artwork-viewer-overlay ${closing ? "artwork-viewer-closing" : ""}`} role="dialog" aria-modal="true" aria-label="Album artwork" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } else if (event.key === "Tab") { event.preventDefault(); closeButton.current?.focus(); } }}>
    <div className="artwork-viewer">
      <div className="artwork-viewer-image">
        <Artwork src={track.album_art_url} size={560} />
        <button ref={closeButton} type="button" aria-label="Close artwork" onClick={close}><X size={20} /></button>
      </div>
      <div className="artwork-viewer-info">
        <MarqueeText className="artwork-viewer-title">{track.title}</MarqueeText>
        <MarqueeText className="artwork-viewer-artist">{track.artist}</MarqueeText>
      </div>
    </div>
  </div>, document.body);
}
