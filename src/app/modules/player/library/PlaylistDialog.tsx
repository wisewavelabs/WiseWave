import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, X } from "lucide-react";

export function PlaylistDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, description: string, cover?: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [closing, setClosing] = useState(false);
  const [cover, setCover] = useState<string>();
  const [imageError, setImageError] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const imageVersion = useRef(0);
  const closeTimer = useRef<number | null>(null);
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const chooseImage = (file?: File) => {
    if (!file) return;
    const version = ++imageVersion.current;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setImageLoading(false);
      setImageError("Choose a JPG, PNG or WebP image under 10 MB.");
      return;
    }
    setImageLoading(true);
    setImageError("");
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 320;
        const context = canvas.getContext("2d");
        if (!context || !image.naturalWidth || !image.naturalHeight) throw new Error();
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 320, 320);
        if (version === imageVersion.current) setCover(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        if (version === imageVersion.current) setImageError("Could not load this image. Try another one.");
      } finally {
        URL.revokeObjectURL(url);
        if (version === imageVersion.current) setImageLoading(false);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      if (version === imageVersion.current) { setImageLoading(false); setImageError("Could not load this image. Try another one."); }
    };
    image.src = url;
  };

  const dismiss = (action: () => void) => {
    if (closeTimer.current !== null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce") {
      action();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(action, 180);
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(() => closeRef.current()); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { imageVersion.current++; document.removeEventListener("keydown", keydown, true); if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); previousFocus.current?.focus(); };
  }, []);

  return createPortal(<div className={`playlist-dialog-overlay ${closing ? "closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(onClose); }}>
    <form className="playlist-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-dialog-title" onSubmit={(event) => { event.preventDefault(); if (name.trim() && !imageLoading) dismiss(() => onCreate(name.trim(), description.trim(), cover)); }}>
      <header><h2 id="playlist-dialog-title">Create playlist</h2><button type="button" aria-label="Close" onClick={() => dismiss(onClose)}><X size={20} /></button></header>
      <div className="playlist-image-field">
        <label className="playlist-image-picker">
          {cover ? <img src={cover} alt="" /> : <ImagePlus size={25} aria-hidden="true" />}
          <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose playlist image" onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        <div><strong>Playlist image</strong><small>optional, add a jpg, png or webp image</small>{cover && <button type="button" onClick={() => { imageVersion.current++; setCover(undefined); setImageLoading(false); setImageError(""); }}>Remove</button>}</div>
      </div>
      {imageError && <p className="playlist-image-error" role="alert">{imageError}</p>}
      <label>Name <span aria-hidden="true">*</span><input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Description <small>Optional</small><textarea maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <footer><button type="button" onClick={() => dismiss(onClose)}>Cancel</button><button type="submit" disabled={!name.trim() || imageLoading}>Create</button></footer>
    </form>
  </div>, document.body);
}
