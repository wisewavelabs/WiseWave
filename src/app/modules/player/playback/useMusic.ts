import { useCallback, useEffect, useRef, useState } from "react";
import { Discord, HistoryExport, Music, Playback, TrayControl, events, type DiscordState, type Line, type PlaybackState, type Track } from "../../../mygo";
import { artworkURL, hasArtworkURL } from "../../../shared/ui/Artwork";

function parseDuration(duration?: string | number): number {
  if (typeof duration === "number" && duration > 0) return duration;
  if (!duration || typeof duration !== "string") return 0;
  const parts = duration.split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function readPlaybackSettings() {
  try { return JSON.parse(localStorage.getItem("wisewave-settings") || "{}"); }
  catch { return {}; }
}

function readCurrentTrack(): Track | null {
  try {
    const raw = localStorage.getItem("wisewave-current-track");
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value && typeof (value as Track).id === "string" && typeof (value as Track).title === "string") {
      return value as Track;
    }
  } catch {}
  return null;
}

function readHistory(): Track[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("wisewave-history") || "[]");
    return Array.isArray(value) ? value.filter((track): track is Track => typeof track?.id === "string" && typeof track?.title === "string" && typeof track?.artist === "string").slice(0, 30) : [];
  } catch { return []; }
}

export function useMusic() {
  const playbackVersion = useRef(0);
  const seekVersionRef = useRef(0);
  const seekPending = useRef(false);
  const seekChain = useRef<Promise<void>>(Promise.resolve());
  const [seekVersion, setSeekVersion] = useState(0);
  const restoredTrack = useRef<Track | null>(null);
  const pendingRestore = useRef<{ id: string; position: number } | null>(null);
  const restorePreparation = useRef<Promise<boolean> | null>(null);
  const volumeChain = useRef<Promise<void>>(Promise.resolve());
  const [track, setTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [history, setHistory] = useState<Track[]>(readHistory);
  const historyRef = useRef(history);
  historyRef.current = history;
  const clearHistory = () => {
    try {
      localStorage.setItem("wisewave-history", "[]");
      historyRef.current = [];
      historyAddedRef.current = track?.id ?? null;
      setHistory([]);
      return true;
    } catch {
      return false;
    }
  };
  const exportHistory = () => HistoryExport.save(JSON.stringify({ exportedAt: new Date().toISOString(), history: historyRef.current }, null, 2));
  const [popular, setPopular] = useState<Track[]>([]);
  const [forYou, setForYou] = useState<Track[]>([]);
  const [playing, setPlaying] = useState(false);
  const [trackLoading, setTrackLoading] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const bufferStall = useRef<{ position: number; since: number } | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => { const value = readPlaybackSettings().vol; return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 70; });
  const [muted, setMuted] = useState(false);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);
  volumeRef.current = volume;
  mutedRef.current = muted;
  const [repeatMode, setRepeatMode] = useState<"off" | "track" | "queue">("off");
  const repeat = repeatMode === "track";
  const setRepeat = (enabled: boolean) => setRepeatMode(enabled ? "track" : "off");
  const cycleRepeat = () => setRepeatMode((mode) => mode === "off" ? "track" : mode === "track" ? "queue" : "off");
  const [autoplay, setAutoplay] = useState(() => readPlaybackSettings().auto !== false);
  const [playbackSettings, setPlaybackSettings] = useState(readPlaybackSettings);
  const [upNext, setUpNext] = useState<Track[]>([]);
  const [mixTracks, setMixTracks] = useState<Track[]>([]);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const nextPending = useRef<number | null>(null);
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;
  const relatedRef = useRef<{ id: string; tracks: Promise<Track[]> } | null>(null);
  const [error, setError] = useState("");
  const [lyrics, setLyrics] = useState<Line[]>([]);
  const [lyricsCredit, setLyricsCredit] = useState<import("../../../mygo").Record | null>(null);
  const [plainLyrics, setPlainLyrics] = useState("");
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const historyAddedRef = useRef<string | null>(null);
  const playTimeRef = useRef<{ trackId: string; listenedSec: number }>({ trackId: "", listenedSec: 0 });

  const [playbackState, setPlaybackState] = useState<PlaybackState | null>(null);
  const [discordEnabled, setDiscordEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem("wisewave-discord-enabled") === "true"; }
    catch { return false; }
  });

  const [privateListening, setPrivateListening] = useState(() => {
    try { return localStorage.getItem("wisewave-private-listening") === "true"; }
    catch { return false; }
  });
  const discordSync = useRef<Promise<void>>(Promise.resolve());
  const discordVersion = useRef(0);
  const togglePrivateListening = () => {
    const next = !privateListening;
    setPrivateListening(next);
    try { localStorage.setItem("wisewave-private-listening", String(next)); }
    catch { setError("Private listening preference could not be saved."); }
  };

  const toggleDiscord = (enabled: boolean) => {
    setDiscordEnabled(enabled);
    try { localStorage.setItem("wisewave-discord-enabled", String(enabled)); }
    catch {}
  };

  useEffect(() => { Music.popular().then(setPopular).catch(() => setError("Popular music is unavailable.")); }, []);
  useEffect(() => {
    let active = true;
    const seeds = history.slice(0, 3);
    if (!seeds.length) { setForYou([]); return; }
    Promise.allSettled(seeds.map((seed) => Music.related(seed.id))).then((results) => {
      if (!active) return;
      const seen = new Set(history.map((item) => item.id));
      const tracks: Track[] = [];
      for (const result of results) if (result.status === "fulfilled") for (const item of result.value) if (item.id && !seen.has(item.id)) { seen.add(item.id); tracks.push(item); }
      setForYou(tracks.slice(0, 30));
    });
    return () => { active = false; };
  }, [history]);

  const play = useCallback((item: Track, list: Track[] = [item]) => {
    playbackVersion.current++;
    pendingRestore.current = null;
    seekVersionRef.current += 1;
    setSeekVersion(seekVersionRef.current);
    seekPending.current = false;
    historyAddedRef.current = null;
    playTimeRef.current = { trackId: item.id, listenedSec: 0 };
    setTrackLoading(true);
    setTrack({ ...item });
    setPlaying(true);
    setPosition(0);
    setDuration(item.duration_seconds || parseDuration(item.duration) || 0);
    setUpNext(list.slice(Math.max(0, list.findIndex((entry) => entry.id === item.id)) + 1));
    setError("");
    if (readPlaybackSettings().resume !== false) { try { localStorage.setItem("wisewave-current-track", JSON.stringify(item)); } catch {} }
  }, []);

  useEffect(() => {
    if (track && playbackSettings.resume !== false) {
      try { localStorage.setItem("wisewave-current-track", JSON.stringify(track)); } catch {}
    }
  }, [track, playbackSettings.resume]);

  useEffect(() => {
    let active = true;
    const version = playbackVersion.current;
    void Playback.state().then((state) => {
      if (!active || playbackVersion.current !== version) return;
      const cached = readPlaybackSettings().resume === false ? null : readCurrentTrack();
      if (!state.track_id) {
        if (!cached) return;
        const savedPosition = Number(localStorage.getItem("wisewave-current-position"));
        const position = Number.isFinite(savedPosition) ? Math.max(0, savedPosition) : 0;
        pendingRestore.current = { id: cached.id, position };
        restoredTrack.current = cached;
        setTrack(cached);
        setPosition(position);
        setDuration(cached.duration_seconds || parseDuration(cached.duration));
        setTrackLoading(true);
        const preparation = Playback.prepare(cached.id, position).then(async () => {
          const restored = pendingRestore.current;
          if (active && playbackVersion.current === version && restored?.id === cached.id) {
            if (restored.position !== position) await Playback.seek(restored.position);
            if (active && playbackVersion.current === version && pendingRestore.current === restored) pendingRestore.current = null;
          }
          return true;
        }).catch(() => {
          if (active && playbackVersion.current === version) setError("Could not prepare the last track. Try playing it again.");
          return false;
        }).finally(() => {
          if (restorePreparation.current === preparation) restorePreparation.current = null;
          if (active && playbackVersion.current === version) setTrackLoading(false);
        });
        restorePreparation.current = preparation;
        return;
      }
      const current = (cached && cached.id === state.track_id)
        ? cached
        : readHistory().find((item) => item.id === state.track_id);
      if (!current) return;
      restoredTrack.current = current;
      setTrack(current);
      setPlaying(state.playing);
      setPosition(state.position);
      setDuration(state.duration || current.duration_seconds || parseDuration(current.duration));
      setPlaybackState(state);
    }).catch(() => { if (active && playbackVersion.current === version) setError("Playback status is unavailable."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!track || playbackSettings.resume === false) return;
    try { localStorage.setItem("wisewave-current-position", String(position)); } catch {}
  }, [track, position, playbackSettings.resume]);

  useEffect(() => {
    if (playbackSettings.hist === false) {
      if (history.length) setHistory([]);
      try { localStorage.setItem("wisewave-history", "[]"); } catch {}
      return;
    }
    try { localStorage.setItem("wisewave-history", JSON.stringify(history)); }
    catch { setError("Listening history could not be saved."); }
  }, [history, playbackSettings.hist]);

  useEffect(() => {
    if (!track) return;
    bufferStall.current = null;
    setBuffering(false);
    if (restoredTrack.current === track) {
      restoredTrack.current = null;
      return;
    }
    let active = true;
    void seekChain.current
      .then(() => {
        if (!active) return;
        return Playback.play(track.id);
      })
      .then(() => {
        if (active) {
          setPlaying(true);
          void Playback.state().then((state) => { if (active) setPlaybackState(state); }).catch(() => {});
          void Playback.volume(mutedRef.current ? 0 : volumeRef.current / 100);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setPlaying(false);
          setError(error instanceof Error ? error.message : "Could not start playback.");
        }
      })
      .finally(() => {
        if (active) setTrackLoading(false);
      });

    return () => {
      active = false;
    };
  }, [track]);
  useEffect(() => {
    if (!track) { setLyrics([]); setPlainLyrics(""); setLyricsCredit(null); return; }
    let active = true;
    setLyrics([]); setPlainLyrics(""); setLyricsCredit(null); setLyricsLoading(true);
    Music.lyrics(track.title, track.artist, track.album, Math.round(duration || track.duration_seconds || 0), track.id).then((result) => {
      if (active) { setLyrics(result?.lines || []); setPlainLyrics(result?.plain_lyrics || ""); setLyricsCredit(result); }
    }).catch(() => { if (active) setPlainLyrics("Lyrics unavailable."); }).finally(() => { if (active) setLyricsLoading(false); });
    return () => { active = false; };
  }, [track, duration]);

  useEffect(() => {
    if (!track) {
      setMixTracks([]);
      return;
    }
    let active = true;
    const req = Music.related(track.id);
    relatedRef.current = { id: track.id, tracks: req };
    req.then((tracks) => {
      if (active) {
        setMixTracks(tracks.filter((t) => t.id && t.id !== track.id && hasArtworkURL(t.album_art_url)));
      }
    }).catch(() => {
      if (active) setMixTracks([]);
    });
    return () => { active = false; };
  }, [track?.id]);

  const playQueued = (index: number) => {
    const items = queueRef.current;
    if (!items[index]) return;
    queueRef.current = items.slice(index + 1);
    setQueue(queueRef.current);
    play(items[index]);
  };
  const next = async () => {
    const version = playbackVersion.current;
    if (repeatMode === "queue" && track) {
      const items = queueRef.current;
      if (!items.length) { play(track); return; }
      queueRef.current = [...items.slice(1), track];
      setQueue(queueRef.current);
      play(items[0]);
      return;
    }
    if (queueRef.current.length) { playQueued(0); return; }
    if (nextPending.current === playbackVersion.current) return;
    if (!autoplay || !track) return;
    if (upNext.length) { play(upNext[0], upNext); return; }
    nextPending.current = version;
    try {
      const tracks = await (relatedRef.current?.id === track.id ? relatedRef.current.tracks : Music.related(track.id));
      if (version !== playbackVersion.current || !autoplayRef.current) return;
      if (queueRef.current.length) { playQueued(0); return; }
      const unseen = tracks.filter((item) => item.id !== track.id && hasArtworkURL(item.album_art_url) && !history.some((entry) => entry.id === item.id));
      const candidates = unseen.length ? unseen : tracks.filter((item) => item.id && item.id !== track.id && hasArtworkURL(item.album_art_url));
      const unique = [...new Map(candidates.map((item) => [item.id, item])).values()];
      if (unique.length) play(unique[0], unique);
      else setError("No related tracks are available.");
    } catch {
      if (version === playbackVersion.current) setError("Could not load the next track.");
    } finally { if (nextPending.current === version) nextPending.current = null; }
  };
  const shuffle = () => setQueue((current) => {
    const result = [...current];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  });
  const toggle = async () => {
    if (!track) return;
    const version = playbackVersion.current;
    try {
      if (playing) await Playback.pause();
      else if (pendingRestore.current?.id === track.id) {
        const restored = pendingRestore.current;
        setTrackLoading(true);
        try {
          const prepared = await restorePreparation.current;
          if (version !== playbackVersion.current) return;
          if (!prepared) {
            await Playback.prepare(track.id, restored.position);
            if (version !== playbackVersion.current) return;
            pendingRestore.current = null;
          }
          await Playback.volume(mutedRef.current ? 0 : volumeRef.current / 100);
          await Playback.resume();
        } finally {
          if (version === playbackVersion.current) setTrackLoading(false);
        }
      } else await Playback.resume();
      if (version === playbackVersion.current) setPlaying(!playing);
    } catch {
      if (version === playbackVersion.current) setError("Playback controls are unavailable.");
    }
  };
  const toggleMute = () => { const next = !mutedRef.current; mutedRef.current = next; setMuted(next); void Playback.volume(next ? 0 : volumeRef.current / 100).catch(() => setError("Could not change volume.")); };
  const seek = (seconds: number) => {
    const version = ++seekVersionRef.current;
    const trackVersion = playbackVersion.current;
    seekPending.current = true;
    setSeekVersion(version);
    setPosition(seconds);
    if (pendingRestore.current) {
      pendingRestore.current.position = seconds;
      seekPending.current = false;
      return;
    }
    seekChain.current = seekChain.current.then(async () => {
      if (version !== seekVersionRef.current || trackVersion !== playbackVersion.current) return;
      try { await Playback.seek(seconds); }
      catch { if (version === seekVersionRef.current) setError("Could not seek."); }
      finally { if (version === seekVersionRef.current) seekPending.current = false; }
    });
  };
  const changeVolume = (value: number) => {
    volumeRef.current = value; mutedRef.current = false; setVolume(value); setMuted(false);
    volumeChain.current = volumeChain.current.then(() => Playback.volume(value / 100)).catch(() => setError("Could not change volume."));
  };

  const resetAudioEngine = async () => {
    if (!track) return;
    const currentTrack = track;
    const currentPos = position;
    try {
      await Playback.reset();
      setPlaying(true);
      setError("");
      void Playback.state().then(setPlaybackState).catch(() => {});
    } catch {
      try {
        await Playback.play(currentTrack.id);
        if (currentPos > 0) await Playback.seek(currentPos);
        setPlaying(true);
        setError("");
        void Playback.state().then(setPlaybackState).catch(() => {});
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Could not reset audio engine.");
      }
    }
  };

  const stopPlayback = () => {
    void Playback.stop().catch(() => {});
    setPlaying(false);
    setPosition(0);
    setPlaybackState((current) => current ? { ...current, playing: false, position: 0, buffer_ahead: 0 } : null);
  };

  useEffect(() => {
    if (!track || trackLoading) return;
    let active = true;
    const timer = window.setInterval(() => {
      const version = seekVersionRef.current;
      if (seekPending.current) return;
      void Playback.state().then((state) => {
        if (!active || seekPending.current || version !== seekVersionRef.current || state.track_id !== track.id) return;
        if (playing && state.playing && state.buffering && !state.error) {
          const stalled = bufferStall.current;
          if (!stalled || Math.abs(state.position - stalled.position) > 0.01) {
            bufferStall.current = { position: state.position, since: performance.now() };
            setBuffering(false);
          } else if (performance.now() - stalled.since >= 500) {
            setBuffering(true);
          }
        } else {
          bufferStall.current = null;
          setBuffering(false);
        }
        if (state.duration > 0) setDuration(state.duration);
        setPosition(state.position);
        setPlaybackState(state);

        if (playTimeRef.current.trackId !== track.id) {
          playTimeRef.current = { trackId: track.id, listenedSec: 0 };
        }
        if (playing && state.playing) {
          playTimeRef.current.listenedSec += 0.25;
        }

        const totalDuration = state.duration > 0 ? state.duration : (track.duration_seconds || parseDuration(track.duration) || 0);
        if (playbackSettings.hist !== false && !privateListening && totalDuration > 0 && historyAddedRef.current !== track.id) {
          const halfDuration = totalDuration * 0.5;
          if (state.position >= halfDuration && playTimeRef.current.listenedSec >= Math.min(halfDuration * 0.8, halfDuration)) {
            historyAddedRef.current = track.id;
            setHistory((previous) => [track, ...previous.filter((entry) => entry.id !== track.id)].slice(0, 30));
          }
        }

        if (playing && !state.playing) {
          setPlaying(false);
          if (state.error) setError(state.error);
          else if (state.position > 0) { if (repeat) { seek(0); void Playback.resume(); setPlaying(true); } else next(); }
        }
      }).catch(() => setError("Playback status is unavailable."));
    }, 250);
    return () => { active = false; window.clearInterval(timer); };
  }, [track, playing, trackLoading, repeat, repeatMode, queue, autoplay, playbackSettings.hist, privateListening]);
  useEffect(() => {
    void TrayControl.update({ hasTrack: Boolean(track), playing, hasNext: Boolean(queue.length || (autoplay && track)), muted }).catch(() => setError("Tray controls are unavailable."));
  }, [track, playing, queue.length, autoplay, muted]);

  useEffect(() => {
    const recommendation = mixTracks.find((item) => !history.some((entry) => entry.id === item.id)) || mixTracks[0];
    const nextID = queue[0]?.id || (autoplay ? upNext[0]?.id || recommendation?.id : undefined);
    void Playback.prefetch(playing && !trackLoading ? nextID || "" : "").catch(() => setError("Could not prepare the next track."));
  }, [playing, trackLoading, queue[0]?.id, upNext[0]?.id, autoplay, mixTracks, history]);

  useEffect(() => {
    const handleSettingsUpdate = () => setPlaybackSettings(readPlaybackSettings());
    window.addEventListener("wisewave-settings-updated", handleSettingsUpdate);
    window.addEventListener("storage", handleSettingsUpdate);
    return () => {
      window.removeEventListener("wisewave-settings-updated", handleSettingsUpdate);
      window.removeEventListener("storage", handleSettingsUpdate);
    };
  }, []);

  useEffect(() => {
    void TrayControl.setWindowPreferences(playbackSettings.tray !== false, playbackSettings.mini === true).catch(() => setError("Could not update window preferences."));
  }, [playbackSettings.tray, playbackSettings.mini]);

  useEffect(() => {
    void Playback.setNormalize(playbackSettings.norm !== false).catch(() => setError("Could not update volume normalization."));
  }, [playbackSettings.norm]);

  useEffect(() => {
    void Playback.volume(volumeRef.current / 100).catch(() => setError("Could not set startup volume."));
  }, []);

  const effectiveDuration = Math.round(duration || track?.duration_seconds || parseDuration(track?.duration) || 0);

  useEffect(() => {
    const version = ++discordVersion.current;
    const enabled = discordEnabled && !privateListening;
    const sync = (state?: DiscordState) => {
      discordSync.current = discordSync.current.then(async () => {
        if (version !== discordVersion.current) return;
        await Discord.setEnabled(enabled);
        if (enabled && state && version === discordVersion.current) await Discord.update(state);
      }).catch(() => { if (version === discordVersion.current) setError("Discord presence could not be updated."); });
    };
    if (!enabled) { sync(); return; }
    if (!track) {
      sync({ track_id: "", title: "", artist: "", artist_id: "", album: "", artwork_url: "", position: 0, duration: 0, seek_version: 0, playing: false });
      return;
    }

    if (!playing) {
      sync({
        track_id: "",
        title: "",
        artist: "",
        artist_id: "",
        album: "",
        artwork_url: "",
        position: 0,
        duration: 0,
        seek_version: 0,
        playing: false,
      });
      return;
    }

    const squareArt = track.album_art_url ? artworkURL(track.album_art_url, 600) : "";
    const artistParts = track.artist.split(/\s*(?:,|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring)\s+)\s*/i).map((n) => n.trim()).filter(Boolean);
    const isSingle = artistParts.length === 1;

    sync({
      track_id: track.id,
      title: track.title,
      artist: track.artist,
      artist_id: isSingle ? (track.artist_id || "") : "",
      album: "",
      artwork_url: squareArt || "wisewave_logo",
      position,
      duration: effectiveDuration,
      seek_version: seekVersionRef.current,
      playing,
    });
  }, [discordEnabled, privateListening, track?.id, track?.album_art_url, playing, position, effectiveDuration, seekVersionRef.current]);

  useEffect(() => {
    const handleBeforeUnload = () => { void Discord.close().catch(() => {}); };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      void Discord.close().catch(() => {});
    };
  }, []);
  const actionsRef = useRef({ toggle, next, toggleMute });
  actionsRef.current = { toggle, next, toggleMute };
  useEffect(() => events.trayAction.on((action) => {
    if (action === "toggle") actionsRef.current.toggle();
    else if (action === "next") actionsRef.current.next();
    else if (action === "mute") actionsRef.current.toggleMute();
  }), []);
  return { seek, seekVersion, changeVolume, track, trackLoading, buffering, history, clearHistory, exportHistory, popular, forYou, queue, upNext, mixTracks, playing, position, duration, volume, muted, repeat, repeatMode, cycleRepeat, autoplay, error, lyrics, plainLyrics, lyricsCredit, lyricsLoading, playbackState, discordEnabled, toggleDiscord, privateListening, togglePrivateListening, resetAudioEngine, stopPlayback, play, playQueued, next, shuffle, toggle, toggleMute, setQueue, setError, setPlaying, setPosition, setDuration, setVolume, setRepeat, setAutoplay };
}
