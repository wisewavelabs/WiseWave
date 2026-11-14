import { accountText } from "../shared/accountText";
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import youtubeLikedMusicArt from "../../../../../resources/images/youtube-liked-music.svg";
import { YouTubeAccount, YouTubeLogin, events, type YouTubeAccountStatus, type YouTubeLoginStatus, type YouTubeSyncStatus, type YouTubeImportResult } from "../../../mygo";
import { reportAccountImport } from "../shared/ImportProgress";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { PlayerAlert } from "../../player/shared/PlayerAlert";
import { AccountLibraryDialog } from "../shared/AccountLibraryDialog";

export function YouTubeIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true"><path d="M13 26C20.176 26 26 20.176 26 13S20.176 0 13 0 0 5.824 0 13s5.824 13 13 13Z" fill="#f03" /><path d="M20.5 13a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" stroke="#fff" /><path d="m17.75 13-7.5-4.25v8.5z" fill="#fff" /></svg>;
}

export function YouTubeConnection({ onImport }: { onImport?: (result: YouTubeImportResult) => number }) {
  const [account, setAccount] = useState<YouTubeAccountStatus | null>(null);
  const [login, setLogin] = useState<YouTubeLoginStatus>({ busy: false, error: "" });
  const [sync, setSync] = useState<YouTubeSyncStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [modal, setModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const lastLinked = useRef<boolean | null>(null);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const [nextAccount, nextLogin, nextSync] = await Promise.all([YouTubeAccount.status(), YouTubeLogin.status(), YouTubeAccount.syncStatus()]);
        if (!mounted.current) return;
        if (lastLinked.current === false && nextAccount.linked) { setModal(true); setClosing(false); }
        lastLinked.current = nextAccount.linked;
        setAccount(nextAccount); setLogin(nextLogin); setSync(nextSync);
        if (!nextAccount.linked) { setModal(false); setImporting(null); }
      } catch {
        if (mounted.current) setError("YouTube Music sign-in is available in the desktop app.");
      } finally { reading = false; }
    };
    void refresh();
    void YouTubeAccount.importStatus().then((status) => { if (mounted.current && status.phase === "importing") setImporting(status.source_id); }).catch(() => {});
    const offImport = events.youtubeImportChanged.on((status) => { if (mounted.current) setImporting(status.phase === "importing" ? status.source_id : null); });
    const poll = window.setInterval(() => { void refresh(); }, 1000);
    const offAccount = events.youtubeAccountChanged.on(() => { void refresh(); });
    const offSync = events.youtubeLibrarySyncChanged.on((status) => { if (mounted.current) setSync(status); });
    return () => { mounted.current = false; window.clearInterval(poll); offAccount(); offSync(); offImport(); if (timer.current !== null) window.clearTimeout(timer.current); };
  }, []);

  const closeModal = useCallback(() => {
    if (importing) return;
    if (sync?.phase === "syncing") void YouTubeAccount.cancelSync().catch(() => {});
    setClosing(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setModal(false); setClosing(false); timer.current = null; }, 150);
  }, [importing, sync?.phase]);

  const act = async (action: "start" | "cancel" | "logout" | "sync") => {
    if (pending) return;
    setPending(true); setError("");
    try {
      if (action === "start") await YouTubeLogin.start();
      else if (action === "cancel") await YouTubeLogin.cancel();
      else if (action === "logout") await YouTubeLogin.logout();
      else { const status = await YouTubeAccount.syncLibrary(); if (mounted.current) setSync(status); }
      const [nextAccount, nextLogin] = await Promise.all([YouTubeAccount.status(), YouTubeLogin.status()]);
      if (mounted.current) { setAccount(nextAccount); setLogin(nextLogin); if (action === "logout") { setModal(false); setSync(null); setNote("YouTube Music logged out."); } }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "YouTube Music could not complete this action.");
    } finally { if (mounted.current) setPending(false); }
  };

  const importCollection = async (source: string) => {
    if (importing || !onImport) return;
    reportAccountImport({provider:"youtube",phase:"start",source});
    setImporting(source); setError("");
    try {
      const result = await YouTubeAccount.import(source);
      onImport(result);
      reportAccountImport({provider:"youtube",phase:"complete",matched:result.matched,total:result.total});
      if (mounted.current) { setImporting(null); setModal(false); }
    } catch (cause) {
      reportAccountImport({provider:"youtube",phase:"error",message:cause instanceof Error ? cause.message : "YouTube Music import failed."});
      if (mounted.current) { setImporting(null); }
    }
  };

  const openLibrary = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    setModal(true); setClosing(false);
    if (!sync?.library && sync?.phase !== "syncing") void act("sync");
  };

  const busy = pending || login.busy || Boolean(account?.restoring);
  const message = error || login.error || account?.error;
  const library = sync?.library;
  const username = (library?.username || account?.username || "").replace(/^@+/, "");
  const loading = sync?.phase === "syncing" || (!library && sync?.phase !== "error");

  return <>
    <section className="settings-account" aria-label="YouTube Music account">
      {account?.linked ? <div className="settings-account-card is-linked">
        <div className="settings-account-identity"><div className="settings-account-avatar-wrap">{account.image_url ? <img className="settings-account-avatar" src={account.image_url} alt="" referrerPolicy="no-referrer" width={72} height={72} /> : <span className="settings-account-avatar is-fallback">{account.display_name.slice(0, 1)}</span>}</div>
          <div className="settings-account-copy"><strong>{account.display_name}</strong>{username && <small>@{username}</small>}</div>
          <small className="settings-account-status youtube-status">{importing ? accountText.importing : sync?.phase === "syncing" || busy ? accountText.syncing : <><span className="settings-nav-icon is-youtube"><YouTubeIcon size={18} /></span>{accountText.connected}</>}</small>
        </div>
        <div className="settings-account-stats" aria-label="Library totals"><div><b>{library?.liked_songs ?? accountText.unknownCount}</b><span>Liked music</span></div><div><b>{library?.playlist_count ?? accountText.unknownCount}</b><span>Playlists</span></div></div>
        <div className="settings-action-buttons"><button className="settings-btn" type="button" onClick={openLibrary}>View library</button><button className="settings-btn" type="button" disabled={busy || Boolean(importing)} onClick={() => { void act("logout"); }}>Log out</button></div>
      </div> : <div className="settings-account-card">
        <div className="settings-account-mark settings-nav-icon is-youtube"><YouTubeIcon size={56} /></div><div className="settings-account-copy"><strong>{account?.restoring ? accountText.syncing : busy ? accountText.waitingForYou : accountText.notLinked}</strong><small>{account?.restoring ? "Verifying your saved YouTube Music session." : busy ? accountText.finishSignIn("YouTube Music") : accountText.invitation("YouTube Music")}</small></div>
        <div className="settings-action-buttons"><button className="settings-btn" type="button" disabled={busy || account === null} onClick={() => { void act("start"); }}>{busy ? accountText.waiting : "Link YouTube Music"}</button>{login.busy && <button className="settings-btn" type="button" disabled={pending} onClick={() => { void act("cancel"); }}>Cancel</button>}</div>
      </div>}
      {message && <p className="youtube-library-note" role="alert">{message}</p>}
    </section>
    <AccountLibraryDialog open={modal} closing={closing} title="YouTube Music library" provider="youtube" onClose={closeModal}>
      {loading ? <div className="account-sync-loading" role="status" aria-live="polite"><button className="account-sync-close" type="button" aria-label="Cancel loading" onClick={closeModal}><X size={18} /></button><div className="account-sync-spinner" aria-hidden="true"><i /><i /><i /></div><div className="account-sync-shimmer">{accountText.loading}</div><small>{accountText.reading}</small></div> : sync?.phase === "error" ? <div className="account-sync-error"><button className="account-sync-close" type="button" aria-label="Close library" onClick={closeModal}><X size={18} /></button><p role="alert">{sync.error}</p><button className="settings-btn" type="button" disabled={pending} onClick={() => { void act("sync"); }}>Try again</button></div> : library ? <>

        <div className="account-sync-body"><div className="account-sync-profile">{account?.image_url ? <img src={account.image_url} alt="" width={68} height={68} referrerPolicy="no-referrer" /> : <span className="account-sync-avatar-fallback"><YouTubeIcon size={40} /></span>}<div><strong>{library.display_name}</strong>{username && <small>@{username}</small>}</div><button className="account-sync-close" type="button" disabled={Boolean(importing)} aria-label="Close library" onClick={closeModal}><X size={18} /></button></div>
        <div className="account-sync-stats"><div><b>{library.liked_songs}</b><span>Liked music</span></div><div><b>{library.playlist_count}</b><span>Playlists</span></div></div>
        {error && <p className="youtube-library-note" role="alert">{error}</p>}
        <div className="account-sync-list player-scroll" aria-label="YouTube Music collections">
          <div className="account-sync-row is-liked"><img className="account-sync-cover" src={youtubeLikedMusicArt} alt="" width={48} height={48} /><div className="account-sync-row-copy"><MarqueeText className="account-sync-row-title">Liked music</MarqueeText><span className="account-sync-row-meta">{library.liked_songs} tracks</span></div><button className="account-sync-import" type="button" disabled={!onImport || Boolean(importing) || !library.liked_songs} aria-busy={importing === "liked"} onClick={() => { void importCollection("liked"); }}>{importing === "liked" ? accountText.importing : "Import"}</button></div>
          {library.playlists.map((playlist) => <div className="account-sync-row" key={playlist.id}>{playlist.image_url ? <img className="account-sync-cover" src={playlist.image_url} alt="" width={48} height={48} referrerPolicy="no-referrer" /> : <span className="account-sync-cover empty" />}<div className="account-sync-row-copy"><MarqueeText className="account-sync-row-title">{playlist.name}</MarqueeText><MarqueeText className="account-sync-row-meta">{playlist.track_count ? `${playlist.track_count} tracks` : "Playlist"}{playlist.owner ? ` | Playlist by ${playlist.owner}` : ""}</MarqueeText></div><button className="account-sync-import" type="button" disabled={!onImport || Boolean(importing)} aria-busy={importing === playlist.id} onClick={() => { void importCollection(playlist.id); }}>{importing === playlist.id ? accountText.importing : "Import"}</button></div>)}
          {library.playlists.length === 0 && <p className="youtube-library-empty">No playlists in this YouTube Music account yet.</p>}
        </div></div>
      </> : null}
    </AccountLibraryDialog>
    <PlayerAlert message={note} onDismiss={() => setNote("")} />
  </>;
}
