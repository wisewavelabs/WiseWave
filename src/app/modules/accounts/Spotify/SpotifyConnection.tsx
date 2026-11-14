import { reportAccountImport } from "../shared/ImportProgress";
import { accountText } from "../shared/accountText";
import { useState, useEffect, useRef, useCallback } from "react";
import { AccountLibraryDialog } from "../shared/AccountLibraryDialog";
import { X } from "lucide-react";
import { SpotifyAccount, SpotifyLogin, events, type SpotifySyncStatus, type SpotifyImportResult } from "../../../mygo";
import { Classic } from "../../../shared/ui/Classic";
import { MarqueeText } from "../../../shared/ui/MarqueeText";
import { PlayerAlert } from "../../player/shared/PlayerAlert";
import spotifyLikedSongsArt from "../../../../../resources/images/liked-songs.png";
export function SpotifyIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

export function SpotifyConnection({onImportSpotify}:{onImportSpotify?:(result:SpotifyImportResult)=>number}) {
 const [note,setNote]=useState("");
 const dismissNote=useCallback(()=>setNote(""),[]);
  const [spotifyLinked, setSpotifyLinked] = useState(false);
  const [spotifyName, setSpotifyName] = useState("");
  const [spotifyAvatar, setSpotifyAvatar] = useState("");
  const [spotifyBusy, setSpotifyBusy] = useState(false);
  const [spotifyCancelling, setSpotifyCancelling] = useState(false);
  const [spotifySync, setSpotifySync] = useState<SpotifySyncStatus | null>(null);
  const [spotifyModalOpen, setSpotifyModalOpen] = useState(false);
  const [spotifyModalClosing, setSpotifyModalClosing] = useState(false);
  const [spotifyImportingId, setSpotifyImportingId] = useState<string | null>(null);
  const spotifyModalTimer = useRef<number | null>(null);
  const spotifyModalOpenRef = useRef(false);
  const spotifyWasLinkedRef = useRef<boolean | null>(null);
  useEffect(() => {
    spotifyModalOpenRef.current = spotifyModalOpen;
  }, [spotifyModalOpen]);

  useEffect(() => {
    const syncSpotify = () => {
      void SpotifyAccount.status().then((status) => {
        const linked = Boolean(status?.linked);
        setSpotifyLinked(linked);
        setSpotifyName(status?.display_name || "");
        setSpotifyAvatar(status?.image_url || "");
        if (spotifyWasLinkedRef.current === null) spotifyWasLinkedRef.current = linked;
      }).catch(() => {});
      void SpotifyAccount.syncStatus().then((status) => {
        setSpotifySync(status);
      }).catch(() => {});
      void SpotifyLogin.busy().then(setSpotifyBusy).catch(() => setSpotifyBusy(false));
    };
    syncSpotify();
    void SpotifyAccount.importStatus().then((status) => { if (status.phase === "importing" && status.stage !== "complete") setSpotifyImportingId(status.source_id); }).catch(() => {});
    const offImport = events.spotifyImportChanged.on((status) => setSpotifyImportingId(status.phase === "importing" && status.stage !== "complete" && status.stage !== "error" ? status.source_id : null));
    const offAccount = events.spotifyAccountChanged.on((linked) => {
      syncSpotify();
      const wasLinked = spotifyWasLinkedRef.current;
      if (!linked) {
        setSpotifyModalOpen(false);
        setSpotifySync(null);
        setSpotifyImportingId(null);
        if (wasLinked === true && !spotifyModalOpenRef.current) {
          setNote("Spotify disconnected.");
        }
        spotifyWasLinkedRef.current = false;
        setSpotifyBusy(false);
      }
    });
    const offSync = events.spotifyLibrarySyncChanged.on((status) => {
      setSpotifySync(status);
      if (status?.display_name) setSpotifyName(status.display_name);
      if (status?.image_url) setSpotifyAvatar(status.image_url);
      if (status?.phase === "ready") {
        const wasLinked = spotifyWasLinkedRef.current;
        setSpotifyLinked(true);
        setSpotifyName(status.library?.display_name || status.display_name || "");
        setSpotifyAvatar(status.library?.image_url || status.image_url || "");
        setSpotifyBusy(false);
        if (wasLinked === false && !spotifyModalOpenRef.current) {
          setNote("Spotify linked.");
        }
        spotifyWasLinkedRef.current = true;
      }
      if (status?.phase === "error") {
        setSpotifyBusy(false);
      }
    });
    const timer = window.setInterval(() => {
      void SpotifyLogin.busy().then(setSpotifyBusy).catch(() => {});
    }, 1000);
    return () => {
      offAccount();
      offSync();
      offImport();
      window.clearInterval(timer);
    };
  }, []);

  const closeSpotifyModal = useCallback(() => {
    if (spotifySync?.phase === "syncing" || spotifyImportingId) return;
    setSpotifyModalClosing(true);
    if (spotifyModalTimer.current) window.clearTimeout(spotifyModalTimer.current);
    spotifyModalTimer.current = window.setTimeout(() => {
      setSpotifyModalOpen(false);
      setSpotifyModalClosing(false);
      spotifyModalTimer.current = null;
    }, 150);
  }, [spotifySync?.phase, spotifyImportingId]);

  const startSpotifyImport = useCallback((sourceId: string) => {
    if (spotifyImportingId || !onImportSpotify) return;
    reportAccountImport({provider:"spotify",phase:"start",source:sourceId});
    setSpotifyImportingId(sourceId);
    void SpotifyAccount.import(sourceId).then((result) => {
      onImportSpotify(result);
      reportAccountImport({provider:"spotify",phase:"complete",matched:result.matched,total:result.total});
      setSpotifyImportingId(null);
      setSpotifyModalClosing(true);
      if (spotifyModalTimer.current) window.clearTimeout(spotifyModalTimer.current);
      spotifyModalTimer.current = window.setTimeout(() => {
        setSpotifyModalOpen(false);
        setSpotifyModalClosing(false);
        spotifyModalTimer.current = null;
      }, 150);
    }).catch((error) => {
      setSpotifyImportingId(null);
      reportAccountImport({provider:"spotify",phase:"error",message:error instanceof Error && error.message ? error.message : "Spotify import failed."});
    });
  }, [closeSpotifyModal, onImportSpotify, spotifyImportingId]);

  const logoutSpotify = useCallback(() => {
    if (spotifyBusy || spotifySync?.phase === "syncing" || spotifyImportingId) return;
    setSpotifyBusy(true);
    void SpotifyLogin.logout().then(() => {
      setSpotifyLinked(false);
      setSpotifyName("");
      setSpotifyAvatar("");
      setSpotifySync(null);
      setSpotifyImportingId(null);
      setSpotifyModalOpen(false);
      setNote("Spotify logged out.");
    }).catch((error: unknown) => {
      setNote(error instanceof Error && error.message ? error.message : "Could not log out of Spotify.");
    }).finally(() => setSpotifyBusy(false));
  }, [spotifyBusy, spotifyImportingId, spotifySync?.phase]);


 useEffect(()=>()=>{if(spotifyModalTimer.current!==null)window.clearTimeout(spotifyModalTimer.current)},[]);
 return <><div className="settings-account">
                {spotifyLinked ? (
                  <div className="settings-account-card is-linked">
                    <div className="settings-account-identity">
                      <div className="settings-account-avatar-wrap">
                        {spotifyAvatar ? (
                          <img className="settings-account-avatar" src={spotifyAvatar} alt="" width={72} height={72} />
                        ) : (
                          <span className="settings-account-avatar is-fallback" aria-hidden="true">{(spotifyName || "S").slice(0, 1)}</span>
                        )}
                      </div>
                      <div className="settings-account-copy">
                        <strong>{spotifyName || "Connected"}</strong>
                      </div>
                      <small className="settings-account-status spotify-status">
                        {spotifyImportingId ? accountText.importing : spotifySync?.phase === "syncing" || spotifyBusy ? accountText.syncing : <><span className="settings-nav-icon is-spotify" aria-hidden="true"><SpotifyIcon size={18} /></span>Connected</>}
                      </small>
                    </div>

                    <div className="settings-account-stats" aria-label="Library totals">
                      <div>
                        <b>{spotifySync?.library?.liked_songs ?? spotifySync?.liked_songs ?? accountText.unknownCount}</b>
                        <span>Liked songs</span>
                      </div>
                      <div>
                        <b>{spotifySync?.library?.playlist_count ?? spotifySync?.playlist_total ?? accountText.unknownCount}</b>
                        <span>Playlists</span>
                      </div>
                    </div>

                    <div className="settings-action-buttons">
                      <button
                        type="button"
                        className="settings-btn"
                        onClick={() => {
                          if (spotifyModalTimer.current !== null) {
                            window.clearTimeout(spotifyModalTimer.current);
                            spotifyModalTimer.current = null;
                          }
                          setSpotifyModalOpen(true);
                          setSpotifyModalClosing(false);
                          if (!spotifySync?.library && spotifySync?.phase !== "syncing") {
                            void SpotifyAccount.syncLibrary().catch(() => {});
                          }
                        }}
                      >
                        View library
                      </button>
                      <button
                        type="button"
                        className="settings-btn"
                        disabled={spotifyBusy || spotifySync?.phase === "syncing" || Boolean(spotifyImportingId)}
                        onClick={logoutSpotify}
                      >
                        Log out
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="settings-account-card">
                    <div className="settings-account-mark settings-nav-icon is-spotify" aria-hidden="true">
                      <SpotifyIcon size={40} />
                    </div>
                    <div className="settings-account-copy">
                      <strong>{spotifyBusy ? accountText.waitingForYou : accountText.notLinked}</strong>
                      <small>{spotifyBusy ? accountText.finishSignIn("Spotify") : accountText.invitation("Spotify")}</small>
                    </div>
                    <div className="settings-action-buttons">
                      <button
                        type="button"
                        className="settings-btn"
                        disabled={spotifyBusy || spotifyCancelling}
                        onClick={() => {
                          setSpotifyBusy(true);
                          void SpotifyLogin.start().catch((error: unknown) => {
                            setSpotifyBusy(false);
                            setNote(error instanceof Error && error.message ? error.message : "Could not start Spotify sign-in.");
                          });
                        }}
                      >
                        {spotifyBusy ? accountText.waiting : "Link Spotify"}
                      </button>
                      {spotifyBusy || spotifyCancelling ? (
                        <button
                          type="button"
                          className="settings-btn"
                          disabled={spotifyCancelling}
                          aria-busy={spotifyCancelling}
                          onClick={() => {
                            setSpotifyCancelling(true);
                            void SpotifyLogin.cancel().then(() => setSpotifyBusy(false)).catch((error: unknown) => {
                              setNote(error instanceof Error && error.message ? error.message : "Could not cancel Spotify sign-in.");
                            }).finally(() => setSpotifyCancelling(false));
                          }}
                        >
                          {spotifyCancelling ? <Classic className="account-sync-import-loader" /> : "Cancel"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
<AccountLibraryDialog open={spotifyModalOpen} closing={spotifyModalClosing} title="Spotify library" provider="spotify" onClose={closeSpotifyModal}>
            {spotifySync?.phase === "syncing" || (!spotifySync?.library && spotifyBusy) ? (
              <div className="account-sync-loading" role="status" aria-live="polite">
                <button type="button" className="account-sync-close" aria-label="Close" disabled onClick={closeSpotifyModal}>
                  <X size={18} />
                </button>
                <div className="account-sync-spinner" aria-hidden="true">
                  <i /><i /><i />
                </div>
                <div className="account-sync-shimmer">{accountText.loading}</div>
                <small>
                  {spotifySync?.playlists_loaded
                    ? `${spotifySync.playlists_loaded}${spotifySync.playlist_total ? ` / ${spotifySync.playlist_total}` : ""} playlists`
                    : spotifySync?.liked_songs
                      ? `${spotifySync.liked_songs} liked songs found`
                      : accountText.reading}
                </small>
              </div>
            ) : spotifySync?.phase === "error" ? (
              <div className="account-sync-error">
                <button type="button" className="account-sync-close" aria-label="Close" onClick={closeSpotifyModal}>
                  <X size={18} />
                </button>
                <p>{spotifySync.error || "Could not sync your Spotify library."}</p>
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => {
                    void SpotifyAccount.syncLibrary().catch(() => {});
                  }}
                >
                  Try again
                </button>
              </div>
            ) : spotifySync?.library ? (
              <div className="account-sync-body">
                <div className="account-sync-profile">
                  {spotifySync.library.image_url ? (
                    <img src={spotifySync.library.image_url} alt="" width={68} height={68} />
                  ) : (
                    <span className="account-sync-avatar-fallback" aria-hidden="true"><SpotifyIcon size={22} /></span>
                  )}
                  <div>
                    <strong id="account-sync-title">{spotifySync.library.display_name || spotifyName || "Spotify user"}</strong>
                    {[spotifySync.library.product, spotifySync.library.country].filter(Boolean).length ? (
                      <small>
                        {[spotifySync.library.product, spotifySync.library.country].filter(Boolean).join(" - ")}
                      </small>
                    ) : null}
                    {spotifySync.library.email ? <small>{spotifySync.library.email}</small> : null}
                  </div>
                  <button type="button" className="account-sync-close" aria-label="Close" onClick={closeSpotifyModal}>
                    <X size={18} />
                  </button>
                </div>

                <div className="account-sync-stats">
                  <div><b>{spotifySync.library.liked_songs}</b><span>Liked songs</span></div>
                  <div><b>{spotifySync.library.playlist_count}</b><span>Playlists</span></div>
                </div>

                <div className="account-sync-list player-scroll" aria-label="Spotify playlists">
                  <div className="account-sync-row is-liked">
                    <img className="account-sync-cover" src={spotifyLikedSongsArt} alt="" width={48} height={48} />
                    <div className="account-sync-row-copy">
                      <MarqueeText className="account-sync-row-title">Liked Songs</MarqueeText>
                      <MarqueeText className="account-sync-row-meta">{`${spotifySync.library.liked_songs} tracks`}</MarqueeText>
                    </div>
                    <button
                      type="button"
                      className="account-sync-import"
                      disabled={!onImportSpotify || Boolean(spotifyImportingId)}
                      aria-busy={spotifyImportingId === "liked"}
                      onClick={() => startSpotifyImport("liked")}
                    >
                      {spotifyImportingId === "liked" ? accountText.importing : "Import"}
                    </button>
                  </div>
                  {(spotifySync.library.playlists || []).map((playlist) => {
                    const meta = `${playlist.track_count} tracks${playlist.owner ? ` by ${playlist.owner}` : ""}`;
                    return (
                    <div className="account-sync-row" key={playlist.id}>
                      {playlist.image_url ? (
                        <img className="account-sync-cover" src={playlist.image_url} alt="" width={48} height={48} />
                      ) : (
                        <span className="account-sync-cover empty" aria-hidden="true" />
                      )}
                      <div className="account-sync-row-copy">
                        <MarqueeText className="account-sync-row-title">{playlist.name}</MarqueeText>
                        <MarqueeText className="account-sync-row-meta">{meta}</MarqueeText>
                      </div>
                      <button
                        type="button"
                        className="account-sync-import"
                        disabled={!onImportSpotify || Boolean(spotifyImportingId)}
                        aria-busy={spotifyImportingId === playlist.id}
                        onClick={() => startSpotifyImport(playlist.id)}
                      >
                        {spotifyImportingId === playlist.id ? accountText.importing : "Import"}
                      </button>
                    </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="account-sync-loading" role="status">
                <div className="account-sync-spinner" aria-hidden="true"><i /><i /><i /></div>
                <div className="account-sync-shimmer">{accountText.loading}</div>
              </div>
            )}
</AccountLibraryDialog>
<PlayerAlert message={note} onDismiss={dismissNote}/></>;
}
