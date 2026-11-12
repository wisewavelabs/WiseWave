import { useEffect, useState } from "react";
import { EQ_BANDS, EQ_PRESETS, readEqualizer, saveEqualizer, type EqualizerSettings } from "../player/playback/equalizerSettings";

export function Equalizer() {
  const [settings, setSettings] = useState(readEqualizer);
  useEffect(() => {
    const sync = (event: Event) => setSettings((event as CustomEvent<EqualizerSettings>).detail);
    window.addEventListener("wisewave-equalizer-changed", sync);
    return () => window.removeEventListener("wisewave-equalizer-changed", sync);
  }, []);
  const update = (enabled: boolean, gains: number[]) => {
    const next = { enabled, gains };
    setSettings(next);
    saveEqualizer(next);
  };
  const preset = Object.entries(EQ_PRESETS).find(([, gains]) => gains.every((gain, index) => gain === settings.gains[index]))?.[0] || "Custom";
  const points = settings.gains.map((gain, index) => `${index * 100 + 50},${100 - gain * 8}`).join(" ");
  return <section className="settings-equalizer" aria-label="Equalizer">
    <div className="settings-equalizer-heading"><b>Equalizer</b><button type="button" className="settings-tog" role="switch" aria-label="Equalizer" aria-checked={settings.enabled} onClick={() => update(!settings.enabled, settings.gains)} /></div>
    <div className="settings-equalizer-panel">
      <label className="settings-equalizer-preset">Presets <select value={preset} onChange={(event) => update(settings.enabled, [...EQ_PRESETS[event.target.value]])}><option value="Custom" disabled>Custom</option>{Object.keys(EQ_PRESETS).map((name) => <option key={name}>{name}</option>)}</select></label>
      <div className="settings-equalizer-chart">
        <span className="settings-equalizer-high">+12 dB</span><span className="settings-equalizer-low">−12 dB</span>
        <div className="settings-equalizer-plot">
          <svg viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#8dada6" stopOpacity=".24" /><stop offset="1" stopColor="#8dada6" stopOpacity="0" /></linearGradient></defs>
            {EQ_BANDS.map((frequency, index) => <line key={frequency} x1={index * 100 + 50} x2={index * 100 + 50} y1="4" y2="196" stroke="#ffffff18" vectorEffect="non-scaling-stroke" />)}
            <line x1="0" x2="600" y1="100" y2="100" stroke="#ffffff26" vectorEffect="non-scaling-stroke" />
            <polygon points={`50,196 ${points} 550,196`} fill="url(#eq-fill)" />
            <polyline points={points} fill="none" stroke="#a5bcb7" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="settings-equalizer-sliders">{EQ_BANDS.map((frequency, index) => <div className="settings-equalizer-band" key={frequency}>
            <span className="settings-equalizer-dot" style={{ top: `${50 - settings.gains[index] * 4}%` }} aria-hidden="true" />
            <input type="range" min="-12" max="12" step="1" value={settings.gains[index]} aria-label={`${frequency >= 1000 ? `${frequency / 1000} kilohertz` : `${frequency} hertz`} gain`} aria-valuetext={`${settings.gains[index]} decibels`} onChange={(event) => { const gains = [...settings.gains]; gains[index] = Number(event.target.value); update(settings.enabled, gains); }} />
            <span className="settings-equalizer-frequency">{frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`}</span>
          </div>)}</div>
        </div>
      </div>
      <div className="settings-equalizer-actions"><button type="button" onClick={() => update(settings.enabled, [...EQ_PRESETS.Flat])}>Reset</button></div>
    </div>
  </section>;
}
