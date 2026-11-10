import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { TrayControl, type Track } from "../../mygo";
import { Artwork } from "../../shared/ui/Artwork";
import { PlayerAlert } from "../player/shared/PlayerAlert";
import { AudioLines, BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp, ExternalLink, Code2, Globe, Mic2, Palette, Shield, X } from "lucide-react";
import appIcon from "../../../../resources/icon.png";
import lyricsLicense from "../../../../resources/accompanist-lyrics-license.txt?raw";
import lyricsNotice from "../../../../resources/accompanist-lyrics-notice.txt?raw";
import loadingLicense from "../../../../resources/loading-ui-license.txt?raw";
import reactLicense from "../../../../node_modules/react/LICENSE?raw";
import reactDomLicense from "../../../../node_modules/react-dom/LICENSE?raw";
import lucideLicense from "../../../../node_modules/lucide-react/LICENSE?raw";
import lottieLicense from "../../../../node_modules/lottie-web/LICENSE.md?raw";
import mygoLicense from "../../../../node_modules/mygo-runtime/LICENSE?raw";
import goAACLicense from "../../../../resources/go-aac-license.txt?raw";
import goAudioStreamLicense from "../../../../resources/go-audio-stream-license.txt?raw";
import goM4ALicense from "../../../../resources/go-m4a-license.txt?raw";
import simdLicense from "../../../../resources/simd-license.txt?raw";
import { appVersion } from "../../version";
import { LYRIC_SOURCES } from "../player/lyric-view/LyricCredit";

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface SettingsProps {
  onClose: () => void;
  onClearHistory: () => boolean;
  onExportHistory: () => Promise<boolean>;
  volume: number;
  onVolume: (value: number) => void;
  discordEnabled: boolean;
  onDiscordEnabled: (value: boolean) => void;
  autoplay: boolean;
  onAutoplay: (value: boolean) => void;
  repeat: boolean;
  onRepeat: (value: boolean) => void;
  track?: Track | null;
  position?: number;
  duration?: number;
}

const DEFAULT_SETTINGS = {
  ui: "Default",
  art: true,
  motion: false,
  tray: true,
  mini: false,
  startup: false,
  norm: true,
  vol: 70,
  auto: true,
  resume: true,
  watch: true,
  minlen: 30,
  lyr: true,
  lyrStyle: "Default",
  lyrSize: "Medium",
  lyrOffset: "0 ms",
  dc: true,
  jr: true,
  jrprompt: "After each session",
  jrmood: true,
  jrtime: "21:00",
  jrlock: false,
  jrfmt: "Markdown",
  notif: true,
  nTrack: false,
  nNew: true,
  nUpd: true,
  quiet: false,
  qs: "22:00",
  qe: "07:00",
  gkeys: true,
  hist: true,
};

type SettingsState = typeof DEFAULT_SETTINGS;

interface SettingRowDef {
  k?: keyof SettingsState;
  l: string;
  d?: string | null;
  dep?: keyof SettingsState;
  t: "tog" | "seg" | "dd" | "rng" | "time" | "btn" | "txt" | "kb";
  o?: readonly string[];
  min?: number;
  max?: number;
  u?: string;
  z?: string;
  s?: number;
  a?: string;
  b?: string;
  v?: string | string[];
}

interface SettingGroupDef {
  h: string;
  r: SettingRowDef[];
}

interface SettingSectionDef {
  t: string;
  pre?: "discord";
  g: SettingGroupDef[];
}

const SETTINGS_SECTIONS: Record<string, SettingSectionDef> = {
  appearance: {
    t: "Appearance",
    g: [
      {
        h: "Display",
        r: [
          { k: "ui", l: "Interface size", o: ["Compact", "Default", "Large"], d: "Scales text and spacing across the app.", t: "dd" },
          { k: "art", l: "Lyrics artwork color", d: "Tint the lyrics page with the current cover.", t: "tog" },
          { k: "motion", l: "Reduce motion", d: "Turn off animations and transitions.", t: "tog" },
        ],
      },
      {
        h: "Window",
        r: [
          { k: "tray", l: "Minimize to tray", d: "Keep music playing when you close the window.", t: "tog" },
          { k: "mini", l: "Show mini player when minimized", t: "tog" },
          { k: "startup", l: "Launch at startup", t: "tog" },
        ],
      },
    ],
  },
  playback: {
    t: "Playback",
    g: [
      {
        h: "Sound",
        r: [
          { k: "norm", l: "Normalize volume", d: "Keeps loudness even between tracks.", t: "tog" },
          { k: "vol", l: "Startup volume", min: 0, max: 100, u: "%", z: "Muted", t: "rng" },
        ],
      },
      {
        h: "Queue",
        r: [
          { k: "auto", l: "Autoplay similar music", d: "Keep playing when your queue ends.", t: "tog" },
          { k: "resume", l: "Resume where you left off", t: "tog" },
        ],
      },
    ],
  },
  lyrics: {
    t: "Lyrics",
    g: [
      {
        h: "Display",
        r: [
          { k: "lyr", l: "Synced lyrics", d: "Follow each line with the music.", t: "tog" },
          {
            k: "lyrStyle",
            l: "Lyrics style",
            o: ["Default", "Focus"],
            d: "Choose how synced lyrics animate.",
            t: "dd",
          },
          {
            k: "lyrSize",
            l: "Text size",
            o: ["Small", "Medium", "Large"],
            d: "Choose a comfortable lyrics size.",
            t: "dd",
          },
        ],
      },
      {
        h: "Timing",
        r: [
          {
            k: "lyrOffset",
            l: "Timing offset",
            o: ["-1000 ms", "-500 ms", "0 ms", "+500 ms", "+1000 ms"],
            d: "Adjust lyrics that appear early or late.",
            t: "dd",
          },
        ],
      },
    ],
  },
  library: {
    t: "Library",
    g: [
      {
        h: "Saved music",
        r: [
          { k: "hist", l: "Save listening history", d: "Keep a local record of the tracks you play.", t: "tog" },
          { k: "resume", l: "Resume playback", d: "Pick up where you left off after restarting WiseWave.", t: "tog" },
        ],
      },
      {
        h: "Maintenance",
        r: [
          { l: "Clear listening history", d: "Delete locally stored listening history.", a: "hist", b: "Clear", t: "btn" },
        ],
      },
    ],
  },
  discord: {
    t: "Discord",
    pre: "discord",
    g: [
      {
        h: "Presence",
        r: [
          { k: "dc", l: "Show on Discord", d: "Display your current music activity in your Discord status.", t: "tog" },
        ],
      },
    ],
  },
  privacy: {
    t: "Privacy",
    g: [
      {
        h: "Listening",
        r: [
          { k: "hist", l: "Save listening history", d: "Keeps your listening activity on this device.", t: "tog" },
        ],
      },
      {
        h: "Your data",
        r: [
          { l: "Clear listening history", d: "Remove all saved listening history.", a: "hist", b: "Clear", t: "btn" },
          { l: "Download my data", d: "Export your locally saved listening history.", a: "dl", b: "Download", t: "btn" },
        ],
      },
    ],
  },
  about: { t: "About", g: [] },
};

const LICENSES = [
  { name: "React", license: "MIT", text: reactLicense },
  { name: "React DOM", license: "MIT", text: reactDomLicense },
  { name: "Lucide React", license: "ISC", text: lucideLicense },
  { name: "Lottie Web", license: "MIT", text: lottieLicense },
  { name: "MyGo Runtime", license: "MIT", text: mygoLicense },
  { name: "Accompanist Lyrics UI", license: "Apache 2.0", text: `${lyricsNotice}\n\n${lyricsLicense}` },
  { name: "Loading UI", license: "MIT", text: loadingLicense },
  { name: "go-aac", license: "LGPL-2.1-or-later", text: goAACLicense },
  { name: "go-audio-stream", license: "MIT", text: goAudioStreamLicense },
  { name: "go-m4a", license: "MIT", text: goM4ALicense },
  { name: "simd", license: "MIT", text: simdLicense },
];

const NAV_GROUPS = [
  ["Music", ["appearance", "playback", "lyrics", "library"]],
  ["Connect", ["discord"]],
  ["System", ["privacy", "about"]],
] as const;

function DiscordIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4a19.8 19.8 0 0 0-4.9-1.5l-.7 1.3a18.3 18.3 0 0 0-5.4 0l-.7-1.3a19.7 19.7 0 0 0-4.9 1.5C.6 9 .1 13.5.5 18a20 20 0 0 0 6 3l1.2-2a13 13 0 0 1-1.9-.9l.4-.3c3.9 1.8 8.1 1.8 12 0l.4.3c-.6.4-1.2.7-1.9.9l1.2 2a20 20 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.6ZM8.1 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.1 1.1 2.1 2.4-1 2.4-2.1 2.4Zm7.8 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-1 2.4-2.1 2.4Z" /></svg>;
}

const NAV_ICONS = { appearance: Palette, playback: AudioLines, lyrics: Mic2, library: BookOpen, discord: DiscordIcon, privacy: Shield, about: CircleHelp };

export function Settings({
  onClose,
  onClearHistory,
  onExportHistory,
  volume,
  onVolume,
  discordEnabled,
  onDiscordEnabled,
  autoplay,
  onAutoplay,
  repeat,
  onRepeat,
  track,
  position = 0,
  duration = 0,
}: SettingsProps) {
  const currentPosition = position;
  const currentDuration = duration;
  const [st, setSt] = useState<SettingsState>(() => {
    try {
      const stored = localStorage.getItem("wisewave-settings");
      const parsed = stored ? JSON.parse(stored) : {};
      ["dcPreset", "dcLine1", "dcLine2", "dcLine3", "dcArt", "dcTime", "dcPause"].forEach((key) => delete parsed[key]);
      if (parsed.lyrStyle === "Glow" || parsed.lyrStyle === "Eeriee") parsed.lyrStyle = "Default";
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        vol: parsed.vol ?? DEFAULT_SETTINGS.vol,
        auto: typeof autoplay === "boolean" ? autoplay : parsed.auto ?? DEFAULT_SETTINGS.auto,
        dc: typeof discordEnabled === "boolean" ? discordEnabled : parsed.dc ?? DEFAULT_SETTINGS.dc,
      };
    } catch {
      return {
        ...DEFAULT_SETTINGS,
        vol: volume,
        auto: autoplay,
        dc: discordEnabled,
      };
    }
  });

  const [activeSection, setActiveSection] = useState<string>("appearance");
  const [showLicenses, setShowLicenses] = useState(false);
  const [showLyricsSources, setShowLyricsSources] = useState(false);
  const [query, setQuery] = useState("");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [confirmHistory, setConfirmHistory] = useState(false);
  const [exportingHistory, setExportingHistory] = useState(false);
  const dismissNote = useCallback(() => setNote(""), []);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const mainRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const main = mainRef.current;
    const button = main?.querySelector<HTMLElement>('.settings-ddb[aria-expanded="true"]');
    const menu = button?.parentElement?.querySelector<HTMLElement>(".settings-dd-menu");
    if (!main || !button || !menu) return;
    const bounds = main.getBoundingClientRect();
    const anchor = button.getBoundingClientRect();
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const below = (bounds.bottom - anchor.bottom) / zoom - 8;
    const above = (anchor.top - bounds.top) / zoom - 8;
    const openAbove = below < menu.offsetHeight && above > below;
    menu.dataset.above = String(openAbove);
    menu.style.maxHeight = `${Math.max(0, Math.min(240, openAbove ? above : below))}px`;
  }, [openDropdown]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof autoplay === "boolean" && autoplay !== st.auto) {
      setSt((prev) => ({ ...prev, auto: autoplay }));
    }
  }, [autoplay]);

  useEffect(() => {
    if (typeof discordEnabled === "boolean" && discordEnabled !== st.dc) {
      setSt((prev) => ({ ...prev, dc: discordEnabled }));
    }
  }, [discordEnabled]);

  const saveSetting = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSt((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem("wisewave-settings", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("wisewave-settings-changed", { detail: next }));
      } catch {}

      const root = document.documentElement;
      if (key === "ui") root.dataset.ui = String(value).toLowerCase();
      if (key === "motion") root.dataset.motion = value ? "reduce" : "";

      if (key === "vol" && typeof value === "number") onVolume(value);
      if (key === "auto" && typeof value === "boolean") onAutoplay(value);
      if (key === "dc" && typeof value === "boolean") onDiscordEnabled(value);

      try {
        window.dispatchEvent(new Event("wisewave-settings-updated"));
      } catch {}

      return next;
    });
  };

  const updateSetting = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    if (key === "hist" && value === false) {
      if (!onClearHistory()) {
        setNote("Could not clear listening history.");
        return;
      }
      saveSetting(key, value);
      setNote("Listening history cleared.");
      return;
    }
    if (key === "startup") {
      void TrayControl.setStartup(Boolean(value)).then(() => saveSetting(key, value)).catch((error: unknown) => setNote(error instanceof Error ? error.message : "Could not update launch at startup."));
      return;
    }
    saveSetting(key, value);
  };

  useEffect(() => {
    void TrayControl.startupEnabled().then((enabled) => setSt((previous) => ({ ...previous, startup: enabled }))).catch(() => setNote("Could not check launch at startup."));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.ui = (st.ui || "Default").toLowerCase();
    root.dataset.motion = st.motion ? "reduce" : "";
  }, []);

  const handleAction = (actKey?: string) => {
    if (actKey === "hist") {
      if (!confirmHistory) { setConfirmHistory(true); return; }
      setConfirmHistory(false);
      setNote(onClearHistory() ? "Listening history cleared." : "Could not clear listening history.");
      return;
    }
    if (actKey === "dl") {
      if (exportingHistory) return;
      setExportingHistory(true);
      void onExportHistory().then((saved) => {
        if (saved) setNote("Listening history exported.");
      }).catch(() => setNote("Could not export listening history.")).finally(() => setExportingHistory(false));
      return;
    }
    setNote("This action is unavailable.");
  };

  const closeSettings = () => {
    if (closeTimer.current !== null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce") {
      onCloseRef.current();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), 150);
  };

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest(".settings-dd")) {
        setOpenDropdown(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (openDropdown) setOpenDropdown(null);
        else closeSettings();
      }
    };
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openDropdown]);

  const isDimmed = (dep?: keyof SettingsState) => {
    if (!dep) return false;
    return !st[dep];
  };

  const formatRangeValue = (r: SettingRowDef, val: number) => {
    if (val === 0 && r.z) return r.z;
    return `${val}${r.u === "%" ? "" : " "}${r.u || ""}`;
  };

  const renderControl = (r: SettingRowDef) => {
    if (!r.k && r.t !== "btn" && r.t !== "txt") return null;
    const val = r.k ? st[r.k] : undefined;

    switch (r.t) {
      case "tog":
        return (
          <button
            type="button"
            className="settings-tog"
            role="switch"
            aria-checked={Boolean(val)}
            aria-label={r.l}
            onClick={() => r.k && updateSetting(r.k, !val as any)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                if (r.k) updateSetting(r.k, !val as any);
              }
            }}
          />
        );

      case "seg":
        return (
          <div className="settings-seg" role="group" aria-label={r.l}>
            {r.o?.map((opt) => (
              <button
                type="button"
                key={opt}
                aria-pressed={opt === val}
                onClick={() => r.k && updateSetting(r.k, opt as any)}
              >
                {opt}
              </button>
            ))}
          </div>
        );

      case "dd": {
        const isOpen = openDropdown === r.k;
        return (
          <div className="settings-dd">
            <button
              type="button"
              className="settings-ddb"
              aria-haspopup="listbox"
              aria-expanded={isOpen}
              aria-label={r.l}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setOpenDropdown(r.k as string);
                  const control = event.currentTarget.parentElement;
                  requestAnimationFrame(() => control?.querySelector<HTMLButtonElement>("[aria-selected=true]")?.focus({ preventScroll: true }));
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                setOpenDropdown(isOpen ? null : (r.k as string));
              }}
            >
              <span className="ddl">{r.k === "lyrStyle" ? val === "Focus" ? "Line Focus" : "Word Flow" : String(val)}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {isOpen && (
              <ul className="settings-dd-menu" role="listbox" aria-label={r.l} onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setOpenDropdown(null);
                  (event.currentTarget.previousElementSibling as HTMLButtonElement | null)?.focus();
                } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
                  const index = options.indexOf(document.activeElement as HTMLButtonElement);
                  options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
                }
              }}>
                {r.o?.map((opt) => (
                  <li key={opt}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={opt === val}
                      onClick={() => {
                        if (r.k) updateSetting(r.k, opt as any);
                        (document.activeElement as HTMLElement | null)?.closest(".settings-dd")?.querySelector<HTMLButtonElement>(".settings-ddb")?.focus();
                        setOpenDropdown(null);
                      }}
                    >
                      {r.k === "lyrStyle" ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                          <span style={{ fontWeight: 600 }}>{opt === "Focus" ? "Line Focus" : "Word Flow"}</span>
                          <span style={{ fontSize: 11, opacity: 0.65 }}>
                            {opt === "Focus" ? "Lines grow into focus and fade with distance." : "Words fill as they play; lines glide into view."}
                          </span>
                        </div>
                      ) : (
                        opt
                      )}
                      {opt === val && <Check size={17} strokeWidth={3} aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }

      case "rng": {
        const min = r.min ?? 0;
        const max = r.max ?? 100;
        const numVal = typeof val === "number" ? val : min;
        const pct = ((numVal - min) / (max - min)) * 100;

        return (
          <div className="settings-rng">
            <input
              type="range"
              aria-label={r.l}
              min={min}
              max={max}
              step={r.s || 1}
              value={numVal}
              style={{ "--p": `${pct}%` } as React.CSSProperties}
              onChange={(e) => {
                const nextNum = Number(e.target.value);
                if (r.k) updateSetting(r.k, nextNum as any);
              }}
            />
            <output>{formatRangeValue(r, numVal)}</output>
          </div>
        );
      }

      case "time":
        return (
          <input
            type="time"
            className="settings-time"
            aria-label={r.l}
            value={String(val || "")}
            onChange={(e) => r.k && updateSetting(r.k, e.target.value as any)}
          />
        );

      case "btn":
        return (
          <div className="settings-action-buttons">
            {r.a === "hist" && confirmHistory && <button type="button" className="settings-btn" onClick={() => setConfirmHistory(false)}>Cancel</button>}
            <button type="button" className="settings-btn" disabled={r.a === "dl" && exportingHistory} onClick={() => handleAction(r.a)}>
              {r.a === "hist" && confirmHistory ? "Confirm clear" : r.a === "dl" && exportingHistory ? "Saving…" : r.b}
            </button>
          </div>
        );

      case "txt":
        return <span className="settings-txt">{r.v as string}</span>;

      default:
        return null;
    }
  };

  const renderRow = (r: SettingRowDef, idx: number) => {
    const dimmed = isDimmed(r.dep);
    return (
      <div className={`settings-row ${r.t === "dd" ? "settings-row-select" : ""} ${dimmed ? "dim" : ""}`} key={`${r.l}-${idx}`}>
        <div>
          <b>{r.l}</b>
          {r.d ? <small>{r.d}</small> : null}
        </div>
        {renderControl(r)}
      </div>
    );
  };

  const renderSearchResults = () => {
    const q = query.trim().toLowerCase();
    const matches: { title: string; rows: SettingRowDef[] }[] = [];

    Object.values(SETTINGS_SECTIONS).forEach((section) => {
      const matchedRows = section.g.flatMap((g) => g.r).filter((r) => {
        const text = `${r.l || ""} ${r.d || ""}`.toLowerCase();
        return text.includes(q);
      });
      if (matchedRows.length > 0) {
        matches.push({ title: section.t, rows: matchedRows });
      }
    });

    const matchesAbout = "about wisewave developer github friston discord community website open source licenses".includes(q);
    if (!matches.length && !matchesAbout) {
      return <div className="settings-search-empty" role="status">No results found for &quot;{query.trim()}&quot;.</div>;
    }

    return (
      <div className="settings-in">
        {matchesAbout && <button className="settings-about-search" type="button" onClick={() => { setQuery(""); setActiveSection("about"); setShowLicenses(false); setShowLyricsSources(false); }}>About WiseWave <ChevronRight size={17} /></button>}
        {matches.map((item) => (
          <div key={item.title}>
            <h2>{item.title}</h2>
            <div className="settings-grp">
              {item.rows.map((row, i) => renderRow(row, i))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const currentSection = SETTINGS_SECTIONS[activeSection] || SETTINGS_SECTIONS.appearance;

  const discordPreviewData = useMemo(() => ({
    titleText: track?.title || "-",
    artistText: track?.artist || "-",
    albumText: null,
    artworkSrc: track?.album_art_url || "",
    currentTimeText: track ? formatTime(currentPosition) : "--:--",
    totalTimeText: track ? formatTime(currentDuration) : "--:--",
  }), [track, currentPosition, currentDuration]);

  const progressPercent = track && currentDuration > 0
    ? Math.min(100, Math.max(0, (currentPosition / currentDuration) * 100))
    : 0;

  return (
    <div className={`settings-overlay ${closing ? "settings-closing" : ""}`}>
    <div className="settings-app" role="dialog" aria-modal="true" aria-label="Settings">
      <aside className="settings-aside">
        <div className="settings-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            ref={searchRef}
            placeholder="Search settings"
            aria-label="Search settings"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && <button className="settings-search-clear" type="button" aria-label="Clear settings search" onPointerDown={(event) => event.preventDefault()} onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={10} strokeWidth={3} /></button>}
        </div>

        <nav className="settings-nav" aria-label="Settings sections">
          {NAV_GROUPS.map(([header, ids]) => (
            <div key={header}>
              <h3>{header}</h3>
              {ids.map((id) => {
                const Icon = NAV_ICONS[id];
                return <button
                  type="button"
                  key={id}
                  className="settings-nav-item"
                  aria-current={!query.trim() && activeSection === id ? "page" : undefined}
                  onClick={() => {
                    setQuery("");
                    setActiveSection(id);
                    setConfirmHistory(false);
                    setShowLicenses(false);
                    setShowLyricsSources(false);
                    if (mainRef.current) mainRef.current.scrollTop = 0;
                  }}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{SETTINGS_SECTIONS[id]?.t}</span>
                </button>;
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="settings-body">
        <header className="settings-header">
          <strong>{query.trim() ? "Search" : showLicenses && activeSection === "about" ? showLyricsSources ? "Lyrics sources" : "Open source licenses" : currentSection.t}</strong>
          <button className="settings-close" type="button" onClick={closeSettings} aria-label="Close settings"><X size={20} /></button>
        </header>
      <main className="settings-main" ref={mainRef}>
        {query.trim() ? (
          renderSearchResults()
        ) : (
          <div className="settings-in">

            {activeSection === "about" && (showLicenses ? <div className="settings-about-licenses">
              {showLyricsSources ? <>
                <button className="settings-about-back" type="button" onClick={() => { setShowLyricsSources(false); if (mainRef.current) mainRef.current.scrollTop = 0; }}><ChevronLeft size={17} aria-hidden="true" />Open source licenses</button>
                <div className="settings-licenses-heading"><h1>Lyrics sources</h1><p>Sources and communities that provide lyrics in WiseWave.</p></div>
                <div className="settings-license-list settings-source-list">{Object.entries(LYRIC_SOURCES).map(([id, source]) => <a key={id} href={source.url} target="_blank" rel="noopener noreferrer"><span><strong>{source.name}</strong><small>{source.notice}</small></span><ExternalLink size={17} /></a>)}</div>
              </> : <>
                <button className="settings-about-back" type="button" onClick={() => setShowLicenses(false)}><ChevronLeft size={17} aria-hidden="true" />About</button>
                <div className="settings-licenses-heading"><h1>Open source licenses</h1><p>Licenses and notices for included components.</p></div>
                <section className="settings-lyrics-credits" aria-labelledby="lyrics-credits-title">
                  <h2 id="lyrics-credits-title">Lyrics credits</h2>
                  <p>Thanks to the people and communities who provide lyrics for WiseWave.</p>
                  <button type="button" onClick={() => { setShowLyricsSources(true); if (mainRef.current) mainRef.current.scrollTop = 0; }}>See all sources <ChevronRight size={17} /></button>
                </section>
                <div className="settings-license-list">{LICENSES.map((entry) => <details key={entry.name}>
                  <summary><span><strong>{entry.name}</strong><small>{entry.license}</small></span><ChevronRight size={18} /></summary>
                  <pre>{entry.text}</pre>
                </details>)}</div>
              </>}
            </div> : <div className="settings-about">
              <div className="settings-about-brand"><img src={appIcon} alt="" /><div><h1>WiseWave</h1><span>Desktop · Version {appVersion}</span></div></div>
              <h2>Developer</h2>
              <a href="https://github.com/Fristonn" target="_blank" rel="noreferrer"><Code2 size={21} /><span><strong>GitHub</strong><small>github.com/Fristonn</small></span><ExternalLink size={17} /></a>
              <a href="https://discord.com/users/1240601660984791040" target="_blank" rel="noreferrer"><DiscordIcon size={21} /><span><strong>Friston</strong><small>Hellooooo, Cutieee &lt;3</small></span><ExternalLink size={17} /></a>
              <h2>Community</h2>
              <a href="https://discord.gg/xNYnxjE6hS" target="_blank" rel="noreferrer"><DiscordIcon size={21} /><span><strong>Discord</strong><small>discord.gg/xNYnxjE6hS</small></span><ExternalLink size={17} /></a>
              <h2>App</h2>
              <a href="https://wisewave.me" target="_blank" rel="noreferrer"><Globe size={21} /><span><strong>Website</strong><small>wisewave.me</small></span><ExternalLink size={17} /></a>
              <button type="button" onClick={() => { setShowLicenses(true); if (mainRef.current) mainRef.current.scrollTop = 0; }}><BookOpen size={21} /><span><strong>Open source licenses</strong><small>Licenses and notices for included components</small></span><ChevronRight size={19} /></button>
            </div>)}

            {currentSection.pre === "discord" && (
              <div className="settings-pv settings-dcp">
                <div className="discord-preview-heading">Preview</div>
                <div className="discord-shell">
                  <div className={`discord-activity ${!st.dc ? "dim" : ""}`}>
                    <div className="discord-label">Listening to WiseWave</div>
                    <div className="discord-body">
                      {discordPreviewData.artworkSrc !== null && (
                        discordPreviewData.artworkSrc && discordPreviewData.artworkSrc !== "wisewave_logo" ? (
                          <Artwork className="discord-art" src={discordPreviewData.artworkSrc} size={76} />
                        ) : discordPreviewData.artworkSrc === "wisewave_logo" ? (
                          <img className="discord-art" src={appIcon} alt="" />
                        ) : (
                          <div className="discord-placeholder">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 18V5l12-2v13" />
                              <circle cx="6" cy="18" r="3" />
                              <circle cx="18" cy="16" r="3" />
                            </svg>
                          </div>
                        )
                      )}
                      <div className="discord-details">
                        {discordPreviewData.titleText !== null && (
                          <div className="discord-track">{track ? discordPreviewData.titleText : "Nothing playing"}</div>
                        )}
                        {track && discordPreviewData.artistText !== null && (
                          <div className="discord-artist">{discordPreviewData.artistText}</div>
                        )}
                        {track && discordPreviewData.albumText !== null && (
                          <div className="discord-album">{discordPreviewData.albumText}</div>
                        )}
                        {track && (
                          <div className="discord-progress">
                            <span>{discordPreviewData.currentTimeText}</span>
                            <span className="discord-line" aria-hidden="true">
                              <i style={{ width: `${progressPercent}%` }} />
                            </span>
                            <span>{discordPreviewData.totalTimeText}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentSection.g.map((group) => (
                <div key={group.h}>
                  <h2>{group.h}</h2>
                  <div className="settings-grp">
                    {group.r.map((row, i) => renderRow(row, i))}
                  </div>
                </div>
              ))}

          </div>
        )}
      </main>
      </div>
      <PlayerAlert message={note} onDismiss={dismissNote} />
    </div>
    </div>
  );
}
