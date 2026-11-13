import type { ListeningRewind } from "./types";
import { countLabel, formatListened } from "./format";

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

export async function shareRecap(recap: ListeningRewind, period = recap.label || "Rewind") {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create the recap image.");
  ctx.fillStyle = "#0c0c0c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#a4a4a4";
  ctx.font = "500 28px Figtree, sans-serif";
  ctx.fillText("WISEWAVE", 80, 120);
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 84px Figtree, sans-serif";
  ctx.fillText("Rewind", 80, 230);
  ctx.fillStyle = "#a4a4a4";
  ctx.font = "500 36px Figtree, sans-serif";
  ctx.fillText(period, 80, 290);
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 92px Figtree, sans-serif";
  ctx.fillText(formatListened(recap.listened_ms), 80, 430);
  ctx.fillStyle = "#a4a4a4";
  ctx.font = "500 28px Figtree, sans-serif";
  ctx.fillText([countLabel(recap.plays, "play"), countLabel(recap.tracks, "song"), countLabel(recap.artists, "artist")].join("  ·  "), 80, 490);
  ctx.strokeStyle = "#ffffff22";
  ctx.beginPath();
  ctx.moveTo(80, 560);
  ctx.lineTo(1000, 560);
  ctx.stroke();
  const rows = [
    recap.top_tracks[0] ? `Top song  ${recap.top_tracks[0].title}${recap.top_tracks[0].artist ? ` — ${recap.top_tracks[0].artist}` : ""}` : "",
    recap.top_artists[0] ? `Top artist  ${recap.top_artists[0].name}` : "",
    recap.top_albums[0] ? `Top album  ${recap.top_albums[0].title}${recap.top_albums[0].artist ? ` — ${recap.top_albums[0].artist}` : ""}` : "",
    recap.discoveries.length ? countLabel(recap.discoveries.length, "new discovery") : "",
  ].filter(Boolean);
  ctx.fillStyle = "#ffffff";
  ctx.font = "500 34px Figtree, sans-serif";
  let y = 640;
  for (const row of rows) {
    for (const line of wrap(ctx, row, 900)) {
      ctx.fillText(line, 80, y);
      y += 52;
    }
    y += 18;
  }
  const milestone = recap.changes?.[0] || recap.milestones[0];
  if (milestone) {
    ctx.fillStyle = "#a4a4a4";
    ctx.font = "400 28px Figtree, sans-serif";
    for (const line of wrap(ctx, milestone, 900)) {
      ctx.fillText(line, 80, y);
      y += 40;
    }
  }
  ctx.fillStyle = "#a4a4a4";
  ctx.font = "500 24px Figtree, sans-serif";
  ctx.fillText("Recorded on this device", 80, 1240);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not create the recap image.");
  const filename = `wisewave-rewind-${period.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "recap"}.png`;
  if (await saveWithExport(blob, filename)) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function shareRecapImage(recap: ListeningRewind) {
  return shareRecap(recap, recap.label || "Rewind");
}

async function saveWithExport(blob: Blob, filename: string) {
  try {
    const { call } = await import("mygo-runtime");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return await call<boolean>("ListeningExport.Save", `data:image/png;base64,${btoa(binary)}`, filename) === true;
  } catch {
    return false;
  }
}
