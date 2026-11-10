import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Pencil, X } from "lucide-react";

const NAME_LIMIT = 100;
const DESCRIPTION_LIMIT = 300;

export function PlaylistDialog({ onClose, onCreate, playlist }: { onClose: () => void; onCreate: (name: string, description: string, cover?: string) => void; playlist?: { name: string; description: string; cover?: string } }) {
  const [name, setName] = useState((playlist?.name || "").slice(0, NAME_LIMIT));
  const [description, setDescription] = useState((playlist?.description || "").slice(0, DESCRIPTION_LIMIT));
  const [closing, setClosing] = useState(false);
  const [cover, setCover] = useState<string | undefined>(playlist?.cover);
  const [imageError, setImageError] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const imageVersion = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<number | null>(null);
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const canSubmit = Boolean(name.trim()) && !imageLoading;

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
    closeTimer.current = window.setTimeout(action, 200);
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(() => closeRef.current()); }
      if (event.key === "Tab") {
        const items = Array.from(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([type="file"]):not(:disabled), textarea:not(:disabled)') || []);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { imageVersion.current++; document.removeEventListener("keydown", keydown, true); if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); previousFocus.current?.focus(); };
  }, []);

  return createPortal(<div className={`playlist-dialog-overlay ${closing ? "closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(onClose); }}>
    <form ref={formRef} className="playlist-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-dialog-title" onSubmit={(event) => { event.preventDefault(); if (canSubmit) dismiss(() => onCreate(name.trim(), description.trim(), cover)); }}>
      <header>
        <h2 id="playlist-dialog-title">{playlist ? "Edit details" : "Create playlist"}</h2>
        <button type="button" aria-label="Close" onClick={() => dismiss(onClose)}><X size={20} /></button>
      </header>

      <div className="playlist-dialog-content">
        <div className="playlist-image-field">
          <button type="button" className={`playlist-image-picker ${imageLoading ? "loading" : ""} ${cover ? "has-cover" : ""}`} aria-label="Choose photo" disabled={imageLoading} onClick={() => fileInput.current?.click()}>
            {cover ? <img src={cover} alt="" /> : <ImagePlus size={36} strokeWidth={1.5} aria-hidden="true" />}
            <span className="playlist-image-overlay" aria-hidden="true"><Pencil size={28} strokeWidth={1.75} /><span>Choose photo</span></span>
          </button>
          <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value = ""; }} />
        </div>

        <div className="playlist-dialog-fields">
          <label className={`playlist-field ${name ? "filled" : ""}`}>
            <input autoFocus required maxLength={NAME_LIMIT} placeholder=" " value={name} onChange={(event) => setName(event.target.value.slice(0, NAME_LIMIT))} />
            <span className="playlist-field-label">Name</span>
            <fieldset aria-hidden="true"><legend><span>Name</span></legend></fieldset>
            <span className={`playlist-field-count ${name.length >= NAME_LIMIT ? "limit" : ""}`} aria-live="polite">{name.length}/{NAME_LIMIT}</span>
          </label>
          <label className={`playlist-field playlist-field-area ${description ? "filled" : ""}`}>
            <textarea maxLength={DESCRIPTION_LIMIT} rows={4} placeholder=" " value={description} onChange={(event) => setDescription(event.target.value.slice(0, DESCRIPTION_LIMIT))} />
            <span className="playlist-field-label">Description</span>
            <fieldset aria-hidden="true"><legend><span>Description</span></legend></fieldset>
            <span className={`playlist-field-count ${description.length >= DESCRIPTION_LIMIT ? "limit" : ""}`} aria-live="polite">{description.length}/{DESCRIPTION_LIMIT}</span>
          </label>
        </div>
      </div>

      {imageError && <p className="playlist-image-error" role="alert">{imageError}</p>}

      <footer>
        <button type="button" onClick={() => dismiss(onClose)}>Cancel</button>
        <button type="submit" disabled={!canSubmit}>{playlist ? "Save" : "Create"}</button>
      </footer>
    </form>
  </div>, document.body);
}
