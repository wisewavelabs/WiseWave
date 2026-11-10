import { useEffect, useRef, useState } from "react";
import { History, Search, X } from "lucide-react";
import { Music, type CatalogArtist, type Track } from "../../../mygo";
import { Classic } from "../../../shared/ui/Classic";
import { Artwork } from "../../../shared/ui/Artwork";
import { useSongMenu } from "../shared/SongMenu";
import { loadSearchSuggest, peekSearchSuggest } from "./searchCache";

const storageKey = "wisewave-search-history";
function supportedMusicLink(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" && ((host === "open.spotify.com" && /^(?:\/intl-[a-z]{2})?\/track\/[A-Za-z0-9]{22}(?:\/|$)/i.test(url.pathname)) || (host === "gaana.com" && /^\/song\/[^/]+\/?$/.test(url.pathname)) || (host === "jiosaavn.com" && /^\/song\/[^/]+\/[^/]+\/?$/.test(url.pathname)));
  } catch { return false; }
}

function loadHistory(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(saved)
      ? saved.filter((item): item is string => typeof item === "string").slice(0, 15)
      : [];
  } catch {
    return [];
  }
}

function DeleteHistoryIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" fill="currentColor" viewBox="0 0 18 18">
      <path d="M14.25 2.25h-3V1.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75v.75h-3a1.5 1.5 0 00-1.5 1.5h13.5a1.5 1.5 0 00-1.5-1.5Zm-9.75 12v-9H3v9a3 3 0 003 3h6a3 3 0 003-3v-9h-1.5v9a1.5 1.5 0 01-1.5 1.5H6a1.5 1.5 0 01-1.5-1.5ZM7.5 6a.75.75 0 00-.75.75v6a.75.75 0 101.5 0v-6A.75.75 0 007.5 6Zm3 0a.75.75 0 00-.75.75v6a.75.75 0 101.5 0v-6A.75.75 0 0010.5 6Z" />
    </svg>
  );
}

export function SearchBox({
  query,
  onChange,
  onCommit,
  onSelect,
  onArtist,
}: {
  query: string;
  onChange: (query: string) => void;
  onCommit: (save: (query: string) => void) => void;
  loading: boolean;
  results?: Track[];
  error?: string;
  onSelect: (track: Track, tracks: Track[]) => void;
  onArtist?: (artist: { artist: string; artist_id?: string }) => void;
}) {
  const openSongMenu = useSongMenu();
  const [history, setHistory] = useState(loadHistory);
  const [draft, setDraft] = useState(query);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [preview, setPreview] = useState<Track[]>([]);
  const [artists, setArtists] = useState<CatalogArtist[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tracksFailed, setTracksFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(-1);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => { setDraft(query); }, [query]);

  const update = (items: string[]) => {
    setHistory(items);
    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {}
  };

  const save = (value: string) => {
    const term = value.trim().replace(/\s+/g, " ");
    if (term.length < 2 || /^(https?:\/\/|www\.)/i.test(term)) return;
    update([term, ...history.filter((item) => item.toLowerCase() !== term.toLowerCase())].slice(0, 15));
  };

  useEffect(() => {
    onCommit(save);
  });

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false);
        setSelected(-1);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setSelected(-1);
      }
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", escape);
    };
  }, []);

  useEffect(() => {
    const trimmed = draft.trim();
    if (!open || !trimmed) {
      setSuggestions([]);
      setPreview([]);
      setArtists([]);
      setSearching(false);
      setFailed(false);
      setTracksFailed(false);
      return;
    }
    let active = true;
    const isLink = supportedMusicLink(trimmed);
    const cached = !isLink ? peekSearchSuggest(trimmed) : null;
    if (cached) {
      setSuggestions(cached.suggestions);
      setPreview(cached.preview);
      setArtists(cached.artists);
      setFailed(cached.failed);
      setTracksFailed(cached.tracksFailed);
      setSearching(false);
      setSelected(-1);
    } else {
      setSuggestions([]);
      setPreview([]);
      setArtists([]);
      setSearching(true);
      setFailed(false);
      setTracksFailed(false);
    }
    const timer = window.setTimeout(() => {
      if (isLink) {
        void Music.resolveLink(trimmed).then((track) => {
          if (!active) return;
          setPreview(track ? [track] : []);
          setSelected(-1);
          setFailed(false);
          setTracksFailed(false);
          setSearching(false);
        }).catch(() => {
          if (!active) return;
          setTracksFailed(true);
          setFailed(true);
          setSearching(false);
        });
        return;
      }
      void loadSearchSuggest(trimmed).then((entry) => {
        if (!active) return;
        setSuggestions(entry.suggestions);
        setPreview(entry.preview);
        setArtists(entry.artists);
        setFailed(entry.failed);
        setTracksFailed(entry.tracksFailed);
        setSelected(-1);
        setSearching(false);
      }).catch(() => {
        if (!active) return;
        setFailed(true);
        setSearching(false);
      });
    }, cached ? 0 : 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draft, open]);

  const showHistory = open && !draft.trim();
  const showSuggestions = open && Boolean(draft.trim());
  const showPanel = open && (showSuggestions || history.length > 0);

  const suggestionItems = suggestions;
  const previewItems = preview.slice(0, Math.ceil(preview.length / 2));
  const artistItems = artists;

  const count = showHistory ? history.length : suggestionItems.length + artistItems.length + previewItems.length;
  const activeIndex = selected >= 0 && selected < count ? selected : -1;

  useEffect(() => {
    if (showPanel && activeIndex >= 0) {
      list.current?.querySelector<HTMLElement>(`[data-search-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, showPanel]);

  const commitQuery = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    save(trimmed);
    setDraft(trimmed);
    onChange(trimmed);
    setOpen(false);
    setSelected(-1);
    input.current?.blur();
  };

  return (
    <div
      className="search-box"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setSelected(-1);
        }
      }}
    >
      <form
        className={`search ${showPanel ? "search-expanded" : ""}`}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button")) return;
          input.current?.focus();
          setOpen(true);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (showHistory && activeIndex >= 0 && activeIndex < history.length) {
            commitQuery(history[activeIndex]);
          } else if (showSuggestions && activeIndex >= 0 && activeIndex < suggestionItems.length) {
            commitQuery(suggestionItems[activeIndex]);
          } else if (showSuggestions && activeIndex >= suggestionItems.length && activeIndex < suggestionItems.length + artistItems.length) {
            const artist = artistItems[activeIndex - suggestionItems.length];
            if (artist) onArtist?.({ artist: artist.name, artist_id: artist.id });
            setOpen(false);
            setSelected(-1);
          } else if (showSuggestions && activeIndex >= suggestionItems.length + artistItems.length && previewItems[activeIndex - suggestionItems.length - artistItems.length]) {
            save(draft);
            onSelect(previewItems[activeIndex - suggestionItems.length - artistItems.length], preview);
            setOpen(false);
            setSelected(-1);
          } else if (draft.trim()) {
            commitQuery(draft);
          }
        }}
      >
        <Search size={19} />
        <input
          ref={input}
          aria-label="Search songs, artists, albums"
          aria-expanded={showPanel}
          aria-controls={showPanel ? "search-history" : undefined}
          aria-haspopup="listbox"
          aria-activedescendant={showPanel && activeIndex >= 0 ? `search-option-${activeIndex}` : undefined}
          role="combobox"
          type="search"
          autoComplete="off"
          placeholder="Search songs, artists, albums"
          value={draft}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setSelected(-1);
            setOpen(true);
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              setSelected(-1);
              input.current?.blur();
            } else if (count > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              setOpen(true);
              setSelected((index) =>
                event.key === "ArrowDown"
                  ? (index + 1) % count
                  : (index <= 0 ? count - 1 : index - 1)
              );
            }
          }}
        />
        {!draft && (
          <span className="search-shortcut" aria-hidden="true">
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </span>
        )}
        {searching && draft.trim() && <Classic className="search-loading" aria-label="Searching" />}
        {draft && (
          <button
            className="search-clear"
            type="button"
            aria-label="Clear search"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              input.current?.focus();
              setDraft("");
              if (query) onChange("");
              setOpen(true);
              setSelected(-1);
            }}
          >
            <X size={16} />
          </button>
        )}
      </form>
      {showPanel && (
        <div className="search-history">
          <div
            ref={list}
            id="search-history"
            role="listbox"
            aria-label={showHistory ? "Recent searches" : "Search suggestions"}
          >
            {showHistory ? (
              <div className="search-dropdown-section">
                <div className="search-dropdown-header">
                  <span>Recent searches</span>
                  <button
                    type="button"
                    className="search-dropdown-clear"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      update([]);
                      setSelected(-1);
                      setOpen(false);
                    }}
                  >
                    Clear all
                  </button>
                </div>
                {history.map((item, index) => (
                  <div
                    className={`search-history-row ${activeIndex === index ? "selected" : ""}`}
                    key={`${item}-${index}`}
                    id={`search-option-${index}`}
                    data-search-index={index}
                    role="option"
                    aria-selected={activeIndex === index}
                    onPointerMove={() => setSelected(index)}
                  >
                    <button
                      type="button"
                      className="search-history-select"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => commitQuery(item)}
                    >
                      <span className="search-history-icon">
                        <History size={17} />
                      </span>
                      <span>{item}</span>
                    </button>
                    <button
                      type="button"
                      className="search-history-delete"
                      aria-label={`Delete ${item} from recent searches`}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => {
                        update(history.filter((entry) => entry !== item));
                        setSelected(-1);
                        input.current?.focus();
                      }}
                    >
                      <DeleteHistoryIcon />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="search-dropdown-section">
                {suggestionItems.length > 0 && <div className="search-dropdown-header">Suggestions</div>}
                {suggestionItems.map((item, index) => (
                  <div
                    className={`search-history-row ${activeIndex === index ? "selected" : ""}`}
                    key={`${item}-${index}`}
                    id={`search-option-${index}`}
                    data-search-index={index}
                    role="option"
                    aria-selected={activeIndex === index}
                    onPointerMove={() => setSelected(index)}
                  >
                    <button
                      type="button"
                      className="search-history-select"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => commitQuery(item)}
                    >
                      <span className="search-history-icon">
                        <Search size={17} />
                      </span>
                      <span>{item}</span>
                    </button>
                  </div>
                ))}
                {artistItems.length > 0 && <div className="search-dropdown-header">Artists</div>}
                {artistItems.map((artist, index) => {
                  const optionIndex = suggestionItems.length + index;
                  return <div
                    className={`search-result search-artist ${activeIndex === optionIndex ? "selected" : ""}`}
                    key={artist.id}
                    id={`search-option-${optionIndex}`}
                    data-search-index={optionIndex}
                    role="option"
                    aria-selected={activeIndex === optionIndex}
                    onPointerMove={() => setSelected(optionIndex)}
                  >
                    <button type="button" className="search-result-select" onPointerDown={(event) => event.preventDefault()} onClick={() => { onArtist?.({ artist: artist.name, artist_id: artist.id }); setOpen(false); setSelected(-1); }}>
                      <span className="search-artist-cover"><Artwork src={artist.artwork_url} size={48} placeholder="user" allowNonSquare /></span>
                      <span className="search-result-info"><strong>{artist.name}</strong><small>Artist</small></span>
                    </button>
                  </div>;
                })}
                {previewItems.length > 0 && <div className="search-dropdown-header">Tracks</div>}
                {previewItems.map((track, index) => {
                  const optionIndex = suggestionItems.length + artistItems.length + index;
                  return (
                    <div
                      className={`search-result ${activeIndex === optionIndex ? "selected" : ""}`}
                      key={track.id}
                      id={`search-option-${optionIndex}`}
                      data-search-index={optionIndex}
                      role="option"
                      aria-selected={activeIndex === optionIndex}
                      onPointerMove={() => setSelected(optionIndex)}
                    >
                      <button type="button" className="search-result-select" onPointerDown={(event) => event.preventDefault()} onClick={() => { save(draft); onSelect(track, preview); setOpen(false); setSelected(-1); }}>
                        <span className="search-result-cover"><Artwork src={track.album_art_url} size={48} /></span>
                        <span className="search-result-info">
                          <strong className="song-menu-title" onContextMenu={(event) => openSongMenu(event, track)}>{track.title}</strong>
                          <small>{track.artist}</small>
                        </span>
                      </button>
                    </div>
                  );
                })}
                {tracksFailed && suggestionItems.length > 0 && <p className="search-dropdown-message" role="status">Tracks couldn’t be loaded.</p>}
                {!searching && !suggestionItems.length && !artistItems.length && !preview.length && (
                  <p className="search-dropdown-message">{failed ? "Search is unavailable. Try again." : "No results found"}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
