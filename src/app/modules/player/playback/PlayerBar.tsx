import { useEffect, useRef, useState } from "react";
import { PlayerSlider } from "./PlayerSlider";
import { Heart, ListMusic, Mic2, PictureInPicture2, Play, Volume1, Volume2, VolumeX } from "lucide-react";
import { ListCollapseIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, RepeatIcon, ShuffleIcon } from "../../../shared/ui/icons";
import { IconButton } from "../../../shared/ui/IconButton";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { Artwork, hasArtworkURL } from "../../../shared/ui/Artwork";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import type { Track } from "../../../mygo";
import { ArtistLinks } from "../shared/ArtistLinks";
import { useSongMenu } from "../shared/SongMenu";
import type { useMusic } from "./useMusic";

function time(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PlayerBar({
  music,
  lyricsOpen,
  queueOpen,
  miniOpen,
  onLyrics,
  onQueue,
  onCloseQueue,
  onMini,
  onArtist,
  onArtwork,
  liked,
  onLike,
}: {
  music: ReturnType<typeof useMusic>;
  lyricsOpen: boolean;
  queueOpen: boolean;
  miniOpen: boolean;
  onLyrics: () => void;
  onQueue: () => void;
  onCloseQueue?: () => void;
  onMini: () => void;
  onArtist: (track: Track) => void;
  onArtwork: () => void;
  liked?: boolean;
  onLike?: () => void;
}) {
  const openSongMenu = useSongMenu();
  const [seekPreview, setSeekPreview] = useState<{ id: string; value: number } | null>(null);
  const [volumePreview, setVolumePreview] = useState<number | null>(null);
  const [mixOpen, setMixOpen] = useState(false);
  const queueRef = useRef<HTMLDivElement>(null);
  const mixRef = useRef<HTMLDivElement>(null);
  const queueButtonRef = useRef<HTMLButtonElement>(null);
  const previousQueueSizeRef = useRef(music.queue.length);

  useEffect(() => {
    const previousQueueSize = previousQueueSizeRef.current;
    previousQueueSizeRef.current = music.queue.length;
    if (music.queue.length <= previousQueueSize || !queueButtonRef.current) return;

    const queueButton = queueButtonRef.current;
    const queueCount = queueButton.querySelector<HTMLElement>("[data-queue-count]");
    const baseColor = getComputedStyle(queueButton).color;
    const baseCountBackground = queueCount ? getComputedStyle(queueCount).backgroundColor : "transparent";
    const reduceMotion = document.documentElement.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    queueButton.getAnimations().forEach((animation) => animation.cancel());
    queueCount?.getAnimations().forEach((animation) => animation.cancel());

    queueButton.animate(
      reduceMotion
        ? [{ color: "rgb(255 137 177)" }, { color: baseColor }]
        : [
            { color: baseColor, filter: "drop-shadow(0 0 0 rgb(255 112 158 / 0))", transform: "scale(1)" },
            { color: "rgb(255 137 177)", filter: "drop-shadow(0 0 8px rgb(255 112 158 / .7))", offset: 0.18, transform: "scale(1.16)" },
            { color: "rgb(255 137 177)", filter: "drop-shadow(0 0 5px rgb(255 112 158 / .42))", offset: 0.58, transform: "scale(1.05)" },
            { color: baseColor, filter: "drop-shadow(0 0 0 rgb(255 112 158 / 0))", transform: "scale(1)" },
          ],
      { duration: reduceMotion ? 240 : 1400, easing: "cubic-bezier(.22, 1, .36, 1)" }
    );

    queueCount?.animate(
      reduceMotion
        ? [{ backgroundColor: "rgb(255 137 177)" }, { backgroundColor: baseCountBackground }]
        : [
            { backgroundColor: baseCountBackground, transform: "scale(1)" },
            { backgroundColor: "rgb(255 171 199)", offset: 0.2, transform: "scale(1.42)" },
            { backgroundColor: baseCountBackground, offset: 0.62, transform: "scale(1.12)" },
            { backgroundColor: baseCountBackground, transform: "scale(1)" },
          ],
      { duration: reduceMotion ? 240 : 1400, easing: "cubic-bezier(.22, 1, .36, 1)" }
    );
  }, [music.queue.length]);

  const closeQueue = onCloseQueue || onQueue;

  useEffect(() => {
    if (!queueOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!queueRef.current?.contains(event.target as Node)) {
        closeQueue();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeQueue();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [queueOpen, closeQueue]);

  useEffect(() => {
    if (!mixOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!mixRef.current?.contains(event.target as Node)) {
        setMixOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMixOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mixOpen]);

  const validMixTracks = music.mixTracks.filter((item) => Boolean(item.id && hasArtworkURL(item.album_art_url)));

  const position = seekPreview && seekPreview.id === music.track?.id ? seekPreview.value : music.position;
  const volume = volumePreview ?? (music.muted ? 0 : music.volume);
  const controllable = Boolean(music.track);
  const playbackActive = music.playing && !music.trackLoading;
  const timelineLoading = music.trackLoading || music.buffering;
  const VolumeIcon = music.muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;
  const volumeLabel = music.muted || volume === 0 ? "Unmute" : "Mute";
  const repeatLabel = music.repeatMode === "track" ? "Repeat one" : music.repeatMode === "queue" ? "Repeat all" : "Repeat off";

  return (
    <footer className={`player-bar ${lyricsOpen && music.track ? "player-bar-lyrics" : ""}`}>
      <div className="track-info">
        {music.track && (
          <>
            <Tooltip label="Expand cover">
              <button className="bar-cover" type="button" aria-label="Expand album artwork" onClick={onArtwork}>
                <Artwork className="bar-art" src={music.track.album_art_url} size={64} />
              </button>
            </Tooltip>
            <div className="track-info-text">
              <div className="bar-title song-menu-title" onContextMenu={(event) => { if (music.track) openSongMenu(event, music.track); }}>
                <MarqueeText className="track-title">{music.track.title}</MarqueeText>
              </div>
              <MarqueeText className="track-artist" title={music.track.artist}>
                <ArtistLinks track={music.track} onOpen={onArtist} />
              </MarqueeText>
            </div>
            {onLike && (
              <Tooltip label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"}>
                <button
                  type="button"
                  className={`bar-like-btn ${liked ? "liked" : ""}`}
                  aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
                  aria-pressed={liked}
                  onClick={onLike}
                >
                  <Heart size={18} fill={liked ? "currentColor" : "none"} />
                </button>
              </Tooltip>
            )}
          </>
        )}
      </div>

      <div className="player-center">
        <div className="play-controls">
          <div className="mix-anchor" ref={mixRef}>
            <IconButton
              label="For you <3"
              active={mixOpen}
              disabled={!controllable || !validMixTracks.length}
              onClick={() => setMixOpen((prev) => !prev)}
            >
              <ListCollapseIcon className={`mix-control-icon ${mixOpen ? "active-control" : ""}`} />
            </IconButton>

            {mixOpen && (
              <div className="player-popover mix-popover">
                <div className="mix-popover-header">
                  <strong className="mix-popover-title">
                    For you &lt;3
                    <span className="mix-popover-count">
                      - {validMixTracks.length} {validMixTracks.length === 1 ? "song" : "songs"}
                    </span>
                  </strong>
                </div>
                <div className="mix-popover-list player-scroll">
                  {validMixTracks.length > 0 ? (
                    validMixTracks.map((item, index) => (
                      <div
                        key={`${item.id}-${index}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Play ${item.title}`}
                        className="mix-popover-item"
                        onKeyDown={(event) => {
                          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault();
                            music.play(item, validMixTracks);
                            setMixOpen(false);
                          }
                        }}
                        onClick={() => {
                          music.play(item, validMixTracks);
                          setMixOpen(false);
                        }}
                      >
                        <span className="mix-popover-art-wrap">
                          <Artwork className="mix-popover-art" src={item.album_art_url} size={96} lazy rootMargin="250px 0px" />
                          <span aria-hidden="true" className="mix-popover-play-overlay">
                            <Play size={16} fill="#ffffff" />
                          </span>
                        </span>
                        <span className="mix-popover-info">
                          <span
                            className="song-menu-title"
                            onContextMenu={(event) => openSongMenu(event, item)}
                          >
                            <MarqueeText className="mix-popover-track-title">{item.title}</MarqueeText>
                          </span>
                          <MarqueeText className="mix-popover-track-artist">{item.artist}</MarqueeText>
                        </span>
                        {item.duration ? <span className="mix-popover-duration">{item.duration}</span> : null}
                      </div>
                    ))
                  ) : (
                    <p className="mix-popover-empty">No recommended songs available.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <IconButton
            label="Shuffle queue"
            disabled={!controllable || music.trackLoading || music.queue.length < 2}
            onClick={music.shuffle}
          >
            <ShuffleIcon className="control-icon" />
          </IconButton>
          <IconButton
            label="Previous"
            disabled={!controllable || music.trackLoading || music.history.length < 2}
            onClick={() => music.play(music.history[1])}
          >
            <PreviousIcon className="control-icon" />
          </IconButton>
          <Tooltip label={playbackActive ? "Pause" : "Play"}>
            <button
              className="play-button"
              aria-label={playbackActive ? "Pause" : "Play"}
              type="button"
              disabled={!controllable || music.trackLoading}
              onClick={music.toggle}
            >
              {playbackActive ? <PauseIcon className="control-icon" /> : <PlayIcon className="control-icon" />}
            </button>
          </Tooltip>
          <IconButton
            label="Next"
            disabled={!controllable || music.trackLoading}
            onClick={music.next}
          >
            <NextIcon className="control-icon" />
          </IconButton>
          <IconButton
            label={repeatLabel}
            active={music.repeatMode !== "off"}
            disabled={!controllable || music.trackLoading}
            onClick={music.cycleRepeat}
          >
            <RepeatIcon one={music.repeatMode === "track"} className="control-icon" />
          </IconButton>

          <div className="volume">
            <IconButton
              label={volumeLabel}
              disabled={!controllable || music.trackLoading}
              onClick={music.toggleMute}
            >
              <VolumeIcon size={18} />
            </IconButton>
            <div className="volume-slider-wrap">
              <PlayerSlider
                animateValue
                className="volume-slider"
                disabled={!controllable || music.trackLoading}
                label="Volume"
                max={100}
                onChange={(value) => { setVolumePreview(value); music.changeVolume(value); }}
                onCommit={() => {
                  setVolumePreview(null);
                }}
                tooltip={(value) => `${Math.round(value)}%`}
                tooltipMode="drag"
                value={volume}
              />
            </div>
          </div>
        </div>

        <div className={`timeline ${controllable ? "" : "inactive"}`} aria-busy={timelineLoading}>
          <span className={`time-label ${timelineLoading ? "player-loading-time" : ""}`}>
            {controllable ? time(position) : "-:--"}
          </span>
          {timelineLoading ? (
            <span className="player-loading-timeline" role="status" aria-label={music.trackLoading ? "Loading selected song" : "Buffering song"} />
          ) : (
            <PlayerSlider
              animateValue
              bufferedValue={
                music.playbackState && music.playbackState.track_id === music.track?.id
                  ? music.playbackState.position + music.playbackState.buffer_ahead
                  : 0
              }
              className="seek-slider"
              disabled={!controllable || music.trackLoading}
              label="Seek"
              max={music.duration || 1}
              value={Math.min(position, music.duration || 1)}
              onChange={(value) => {
                if (music.track) setSeekPreview({ id: music.track.id, value });
              }}
              onCommit={(value) => {
                music.seek(value);
                setSeekPreview(null);
              }}
              tooltip={time}
            />
          )}
          <span className={`time-label ${timelineLoading ? "player-loading-time" : ""}`}>
            {controllable ? time(music.duration) : "-:--"}
          </span>
        </div>
      </div>

      <div className="extra-controls">
        <IconButton
          label="Lyrics"
          active={lyricsOpen}
          disabled={!controllable || music.trackLoading}
          onClick={onLyrics}
        >
          <Mic2 size={24} className={lyricsOpen ? "active-control" : ""} />
        </IconButton>
        <div className="queue-anchor" ref={queueRef}>
          <IconButton
            buttonRef={queueButtonRef}
            label="Queue"
            active={queueOpen}
            disabled={!controllable && !music.queue.length}
            onClick={onQueue}
          >
            <span className="queue-icon-wrapper">
              <ListMusic size={24} className={queueOpen ? "active-control" : ""} />
              {music.queue.length > 0 && (
                <small className="queue-count-badge" data-queue-count>
                  {music.queue.length}
                </small>
              )}
            </span>
          </IconButton>

          {queueOpen && (
            <div className="player-popover queue-popover">
              <div className="queue-popover-header">
                <strong className="queue-popover-title">
                  Next in queue
                  <span className="queue-popover-count">
                    - {music.queue.length} {music.queue.length === 1 ? "song" : "songs"}
                  </span>
                </strong>
                {music.queue.length > 0 && (
                  <button
                    className="queue-popover-clear"
                    type="button"
                    onClick={() => {
                      music.setQueue([]);
                      onQueue();
                    }}
                  >
                    Clear queue
                  </button>
                )}
              </div>
              <div className="queue-popover-list player-scroll">
                {music.queue.length > 0 ? (
                  music.queue.map((item, index) => (
                    <div
                      key={`${item.id}-${index}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Play ${item.title} next`}
                      className="queue-popover-item"
                      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); music.playQueued(index); onQueue(); } }}
                      onClick={() => {
                        music.playQueued(index);
                        onQueue();
                      }}
                    >
                      <span className="queue-popover-art-wrap">
                        <Artwork className="queue-popover-art" src={item.album_art_url} size={48} lazy />
                        <span aria-hidden="true" className="queue-popover-play-overlay">
                          <Play size={16} fill="#ffffff" />
                        </span>
                      </span>
                      <span className="queue-popover-info">
                        <span className="song-menu-title" onContextMenu={(event) => openSongMenu(event, item, { kind: "queue", index })}><MarqueeText className="queue-popover-track-title">{item.title}</MarqueeText></span>
                        <MarqueeText className="queue-popover-track-artist">{item.artist}</MarqueeText>
                      </span>
                      <span className="queue-popover-duration">{item.duration}</span>
                    </div>
                  ))
                ) : (
                  <p className="queue-popover-empty">Your queue is empty.</p>
                )}
              </div>
            </div>
          )}
        </div>
        <IconButton
          label={miniOpen ? "Close miniplayer" : "Miniplayer"}
          active={miniOpen}
          disabled={!controllable || music.trackLoading}
          onClick={onMini}
        >
          <PictureInPicture2 size={24} className={miniOpen ? "active-control" : ""} />
        </IconButton>
      </div>
    </footer>
  );
}
