import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { MiniPlayer } from "./modules/player/mini/MiniPlayer";
import { Player } from "./modules/player/Player";
import splashLogo from "../../resources/splash.svg";
import staticLogo from "../../resources/icon.png";
import "./styles.css";

try {
  const stored = localStorage.getItem("wisewave-settings");
  if (stored) {
    const parsed = JSON.parse(stored);
    if (parsed.ui) document.documentElement.dataset.ui = String(parsed.ui).toLowerCase();
    document.documentElement.dataset.motion = parsed.motion ? "reduce" : "";
  }
} catch {}

const zoomLevels = [0.8, 0.9, 1, 1.1, 1.2, 1.3];
try {
  const savedZoom = Number(localStorage.getItem("wisewave-zoom"));
  if (zoomLevels.includes(savedZoom)) document.documentElement.style.zoom = String(savedZoom);
} catch {}

document.addEventListener("keydown", (event) => {
  if (!event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  const increase = key === "+" || key === "=" || event.code === "NumpadAdd";
  const decrease = key === "-" || key === "_" || event.code === "NumpadSubtract";
  const reset = key === "0" || event.code === "Numpad0";
  if (!increase && !decrease && !reset) return;

  event.preventDefault();
  let current = 1;
  try {
    const savedZoom = Number(localStorage.getItem("wisewave-zoom"));
    if (zoomLevels.includes(savedZoom)) current = savedZoom;
  } catch {}

  const index = zoomLevels.indexOf(current);
  const next = reset ? 1 : zoomLevels[Math.max(0, Math.min(zoomLevels.length - 1, index + (increase ? 1 : -1)))];
  document.documentElement.style.zoom = String(next);
  try { localStorage.setItem("wisewave-zoom", String(next)); } catch {}
}, true);

function App() {
  const [splash, setSplash] = useState<"visible" | "exiting" | "done">("visible");
  const [fontsReady, setFontsReady] = useState(false);
  const reducedMotion = document.documentElement.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    let active = true;
    void Promise.all([document.fonts.load("800 31px Manrope"), document.fonts.load("800 40px Figtree"), document.fonts.load("800 40px Figtree", "Ā"), document.fonts.load("600 14px Manrope", "Ā"), document.fonts.load('800 40px "Figtree Fallback"', "♪")]).then(() => { if (active) setFontsReady(true); }).catch((error: unknown) => { console.error("Bundled fonts could not be loaded", error); if (active) setFontsReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!fontsReady) return;
    if (reducedMotion) { setSplash("done"); return; }
    const exit = window.setTimeout(() => setSplash("exiting"), 1800);
    const done = window.setTimeout(() => setSplash("done"), 2250);
    return () => { window.clearTimeout(exit); window.clearTimeout(done); };
  }, [reducedMotion, fontsReady]);

  return <><div className={`app-content ${splash !== "visible" ? "app-content-visible" : ""}`} inert={splash !== "done"}><Player /></div>{splash !== "done" && <div className={`splash ${splash === "exiting" ? "splash-exiting" : ""}`} role="status" aria-label="Opening WiseWave"><img src={reducedMotion ? staticLogo : splashLogo} alt="" /></div>}</>;
}

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

createRoot(document.getElementById("root")!).render(new URLSearchParams(window.location.search).get("view") === "mini" ? <MiniPlayer /> : <App />);
