import { useEffect, useRef } from "react";
import { SpotifyAccount, YouTubeAccount, events } from "../../../mygo";
import { useSnackbar } from "../../../shared/ui/Snackbar";

type Provider = "spotify" | "youtube";
type ImportReport = { provider: Provider; phase: "start"; source: string } | { provider: Provider; phase: "complete"; matched: number; total: number } | { provider: Provider; phase: "error"; message: string };
type ImportStatus = { phase: string; stage: string; source_id: string; done: number; total: number; matched: number; error: string };
type Task = { key: string; source: string; done: number; total: number; matched: number; dismissed: boolean; finished: boolean };
const importEvent = "wisewave-account-import";

export function reportAccountImport(report: ImportReport) {
  window.dispatchEvent(new CustomEvent<ImportReport>(importEvent, { detail: report }));
}

export function AccountImportNotifications() {
  const show = useSnackbar();
  const tasks = useRef(new Map<Provider, Task>());
  const sequence = useRef(0);
  useEffect(() => {
    let active = true;
    const name = (provider: Provider) => provider === "spotify" ? "Spotify" : "YouTube Music";
    const accent = (provider: Provider) => provider === "spotify" ? "#1ed760" : "#ff0033";
    const draw = (provider: Provider, task: Task, stage: string) => {
      if (task.dismissed || task.finished) return;
      const reading = provider === "spotify" && stage === "fetching";
      const progress = provider === "youtube" ? null : !reading && task.total > 0 ? Math.min(task.done, task.total) / (task.total + 1) : null;
      const label = stage === "complete" ? "Adding to your library..." : provider === "youtube" ? `${task.done} tracks loaded` : reading ? `${task.done} tracks loaded` : task.total > 0 ? `${task.done} / ${task.total} processed, ${task.matched} matched` : `${task.done} tracks loaded`;
      show({ key: task.key, text: `Importing from ${name(provider)}...`, progress, progressLabel: label, accent: accent(provider), duration: -2, onDismiss: () => { task.dismissed = true; } });
    };
    const start = (provider: Provider, source: string) => {
      const task: Task = { key: `account-import:${provider}:${++sequence.current}`, source, done: 0, total: 0, matched: 0, dismissed: false, finished: false };
      tasks.current.set(provider, task); draw(provider, task, "fetching"); return task;
    };
    const fail = (provider: Provider, message: string) => {
      const task = tasks.current.get(provider);
      if (!task || task.finished) return;
      task.finished = true;
      show({ key: task.key, text: `${name(provider)} import failed`, progress: task.total > 0 ? Math.min(task.done, task.total) / (task.total + 1) : 0, progressLabel: message, accent: "#f07178", duration: 5000 });
    };
    const update = (provider: Provider, status: ImportStatus) => {
      if (!active) return;
      let task = tasks.current.get(provider);
      if (!task && status.phase === "importing" && status.stage !== "complete") task = start(provider, status.source_id);
      if (!task || task.finished || task.source !== status.source_id) return;
      if (status.error || status.stage === "error") { fail(provider, status.error || "Please try again."); return; }
      task.done = status.done; task.total = status.total; task.matched = status.matched;
      draw(provider, task, status.stage);
    };
    const report = (event: Event) => {
      const value = (event as CustomEvent<ImportReport>).detail;
      if (value.phase === "start") { start(value.provider, value.source); return; }
      if (value.phase === "error") { fail(value.provider, value.message); return; }
      const task = tasks.current.get(value.provider);
      if (!task || task.finished) return;
      task.finished = true;
      show({ key: task.key, text: `Imported ${value.matched} of ${value.total} tracks from ${name(value.provider)}`, progress: 1, progressLabel: "Import complete", accent: accent(value.provider), duration: 3500 });
    };
    window.addEventListener(importEvent, report);
    const offSpotify = events.spotifyImportChanged.on((status) => update("spotify", status));
    const offYouTube = events.youtubeImportChanged.on((status) => update("youtube", status));
    void SpotifyAccount.importStatus().then((status) => { if (status.phase === "importing") update("spotify", status); }).catch(() => {});
    void YouTubeAccount.importStatus().then((status) => { if (status.phase === "importing") update("youtube", status); }).catch(() => {});
    return () => { active = false; window.removeEventListener(importEvent, report); offSpotify(); offYouTube(); };
  }, [show]);
  return null;
}
