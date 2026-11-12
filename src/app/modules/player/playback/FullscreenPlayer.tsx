import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { events } from "../../../mygo";
import { RepeatIcon, ShuffleIcon } from "../../../shared/ui/icons";
import { Heart, Volume1, Volume2, VolumeX, Minimize } from "lucide-react";
import applePrevious from "../../../../../resources/apple-previous.svg";
import appleNext from "../../../../../resources/apple-next.svg";
import applePlay from "../../../../../resources/apple-play.svg";
import applePause from "../../../../../resources/apple-pause.svg";
import { Artwork, artworkURL } from "../../../shared/ui/Artwork";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { Lyrics } from "../lyric-view/Lyrics";
import { PlayerSlider } from "./PlayerSlider";
import type { useMusic } from "./useMusic";

function time(seconds: number) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

const FullscreenBackdrop = memo(function FullscreenBackdrop({ src }: { src: string }) {
  return <div className="fullscreen-player-backdrop" style={{ backgroundImage: `url(${JSON.stringify(artworkURL(src, 160))})` }} />;
});

export function FullscreenPlayer({ music, onClose, liked, onLike }: { music: ReturnType<typeof useMusic>; onClose: () => void; liked: boolean; onLike: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const musicRef = useRef(music);
  musicRef.current = music;
  const [preview, setPreview] = useState<{ id: string; value: number } | null>(null);

  useLayoutEffect(() => {
    const artwork = dialogRef.current?.querySelector<HTMLElement>(".fullscreen-player-art");
    const lyrics = dialogRef.current?.querySelector<HTMLElement>(".fullscreen-player-lyrics");
    if (!artwork || !lyrics) return;
    const align = () => {
      const art = artwork.getBoundingClientRect();
      const bounds = lyrics.getBoundingClientRect();
      const scale = bounds.height / lyrics.clientHeight || 1;
      const position = (art.top + art.height / 2 - bounds.top) / scale;
      lyrics.style.setProperty("--lyrics-focus-y", `${position}px`);
      const renderer = lyrics.querySelector<HTMLElement>("wisewave-lyrics") as (HTMLElement & { focusPosition?: number; isUserScrolling?: boolean; resumeFollowing: () => void }) | null;
      if (renderer && renderer.focusPosition !== position) {
        renderer.focusPosition = position;
        if (!renderer.isUserScrolling) renderer.resumeFollowing();
      }
    };
    const observer = new ResizeObserver(align);
    observer.observe(artwork);
    if (artwork.parentElement) observer.observe(artwork.parentElement);
    observer.observe(lyrics);
    align();
    return () => observer.disconnect();
  }, []);

  useEffect(() => events.playerFullscreenChanged.on((enabled) => { if (!enabled) onClose(); }), [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== dialogRef.current);
    const states = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    dialogRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      } else if (event.key === "Tab") {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? []);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus(); }
      } else if (event.key === " " && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target instanceof Element && event.target.closest('button, input, [role="slider"]'))) {
        event.preventDefault();
        void musicRef.current.toggle();
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      siblings.forEach((element, index) => { element.inert = states[index]; });
      const target = previous?.getAttribute("aria-label") === "Full screen player" ? document.querySelector<HTMLElement>(".player") : previous;
      target?.focus({ preventScroll: true });
    };
  }, [onClose]);

  const track = music.track;
  const trackID = track?.id;
  useEffect(() => { if (!trackID) onClose(); }, [trackID, onClose]);
  if (!track) return null;
  const position = preview?.id === track.id ? preview.value : music.position;
  const hasNext = Boolean(music.queue.length || music.upNext.length || music.repeatMode === "queue" || music.autoplay);

  return createPortal(<section ref={dialogRef} className="fullscreen-player" role="dialog" aria-modal="true" aria-label="Full screen player" tabIndex={-1}>
    <FullscreenBackdrop src={track.album_art_url} />
    <button className="fullscreen-player-close" type="button" aria-label="Exit full screen" onClick={onClose}><Minimize size={24} /></button>
    <div className="fullscreen-player-left">
      <div className="fullscreen-player-art-wrap"><Artwork className="fullscreen-player-art" src={track.album_art_url} size={720} /></div>
      <div className="fullscreen-player-details">
        <div className="fullscreen-player-heading"><div><h1><MarqueeText>{track.title}</MarqueeText></h1><p><MarqueeText>{track.artist}</MarqueeText></p></div><button className="fullscreen-player-like" type="button" aria-label={liked ? "Unlike song" : "Like song"} aria-pressed={liked} onClick={onLike}><Heart size={24} fill={liked ? "currentColor" : "none"} /></button></div>
        <div className="fullscreen-player-timeline">
          <PlayerSlider label="Song progress" max={music.duration || 1} value={Math.min(position, music.duration || 1)} disabled={music.trackLoading || !music.duration} onChange={(value) => setPreview({ id: track.id, value })} onCommit={(value) => { music.seek(value); setPreview(null); }} tooltip={time} />
          <div className="fullscreen-player-times"><span>{time(position)}</span><span>{time(music.duration)}</span></div>
        </div>
        <div className="fullscreen-player-controls">
          <button className="fullscreen-player-secondary" type="button" aria-label="Shuffle upcoming songs" onClick={music.shuffle} disabled={music.trackLoading || !(music.queue.length > 1 || music.upNext.length > 1 || music.mixTracks.length > 1)}><ShuffleIcon /></button>
          <button type="button" aria-label="Previous song" onClick={music.previous} disabled={music.trackLoading}><img src={applePrevious} alt="" aria-hidden="true" /></button>
          <button className="fullscreen-player-play" type="button" aria-label={music.playing ? "Pause" : "Play"} onClick={() => void music.toggle()} disabled={music.trackLoading}><img className="fullscreen-player-play-icon" src={music.playing ? applePause : applePlay} alt="" aria-hidden="true" /></button>
          <button type="button" aria-label="Next song" onClick={() => void music.next()} disabled={music.trackLoading || !hasNext}><img src={appleNext} alt="" aria-hidden="true" /></button>
          <button className="fullscreen-player-secondary" type="button" aria-label={music.repeatMode === "track" ? "Repeat song" : music.repeatMode === "queue" ? "Repeat all" : "Repeat off"} aria-pressed={music.repeatMode !== "off"} onClick={music.cycleRepeat}><RepeatIcon one={music.repeatMode === "track"} /></button>
        </div>
        <div className="fullscreen-player-volume"><button type="button" aria-label={music.muted ? "Unmute" : "Mute"} onClick={music.toggleMute}>{music.muted || music.volume === 0 ? <VolumeX size={20} /> : <Volume1 size={20} />}</button><PlayerSlider className="fullscreen-player-volume-slider" label="Volume" max={100} value={music.muted ? 0 : music.volume} onChange={music.changeVolume} tooltipMode="drag" tooltip={(value) => `${Math.round(value)}%`} /><Volume2 size={20} aria-hidden="true" /></div>
      </div>
    </div>
    <div className="fullscreen-player-lyrics"><Lyrics credit={music.lyricsCredit} seekVersion={music.seekVersion} lines={music.lyrics} plain={music.plainLyrics} loading={music.lyricsLoading} position={music.position} duration={music.duration} playing={music.playing} track={track} onSeek={music.seek} /></div>
  </section>, document.body);
}
