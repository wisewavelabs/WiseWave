# WiseWave agent guide

## Project rules

- Write self-documenting code. Do not add explanatory comments, docstrings, commented-out code, TODO comments, or section banners in source files. Use clear names, small functions, explicit types, and straightforward control flow. Put architectural explanations in this file or other Markdown documentation.
- Preserve executable/tool directives required by the language or build, including Go build tags, `go:embed`, compiler directives, and dependency manifest annotations. They are functional syntax, not optional explanations. Preserve legally required third-party notices and licenses.
- The owner has requested removal of test files. Do not introduce test files or test scaffolding unless explicitly requested. Validate through compilation, formatting, static analysis, and relevant manual checks; do not claim coverage from tests that do not exist.
- Keep changes within the requested scope. Inspect callers, models, platform variants, and existing conventions before changing a contract. Preserve unrelated work already present in the working tree.
- Keep dedicated search implementations and search caches under `src/runtime/internal/search/`. Existing provider, storage, desktop, and handler files may contain the adapters required to call that module. Frontend search code belongs in its existing player/search folder.
- Do not add providers, external search services, AI dependencies, or heavyweight libraries to solve local search problems. Reuse the current implementations.
- Keep this guide accurate when changing entry points, routes, ownership, persistent storage, or verification commands. Actual source is authoritative if this guide becomes stale.

## Application identity and tooling

- App: WiseWave. Signature: **One more song, then we'll sleep.** The package description contains this line.
- Windows desktop music app built with MyGo, Go, React, TypeScript, and Vite. NSIS builds the Windows installer.
- `package.json`: frontend scripts and dependencies. `package-lock.json`: locked dependency graph; do not edit it by hand.
- `go.mod`: root module `wisewave`, which replaces `wisewave-runtime` with `./src/runtime`. `src/runtime/go.mod`: separate backend module. Run Go checks in both directories.
- Both Go modules declare Go 1.27.3. Read the manifests before changing toolchains or dependencies. README lists Node.js 22 and NSIS as build requirements.
- `mygo.config.ts` forwards to `src/mygo.config.ts`. The latter defines bindings, application ID, development URL, build commands, frontend output, and Windows installer include.
- `src/app/version.ts`: application version used by the MyGo config. Do not casually change application identity, publisher, version, or installer paths.

## Entry points and process boundaries

1. `main.go` embeds `resources/images/icon.png`. Normal startup calls `src/app/native.Run`; the `--server` flag instead calls `src/runtime/app.Run`.
2. `src/app/native/app.go` delegates to `native/windows/app.go`, which creates desktop services, binds them to MyGo, wires listening preferences into search, registers the `audio` protocol, and creates the main window. It also wires Spotify search and token resolution.
3. `src/app/main.tsx` mounts React, loads styles/fonts/settings/zoom, handles the splash screen, and selects the mini-player when `?view=mini` is present.
4. `src/app/modules/player/Player.tsx` owns the main interface, in-app page history, view selection, search, library, and playback composition. It is not a URL-router application.
5. Desktop frontend requests normally use the generated MyGo bridge in `src/app/mygo.ts`, backed by `src/runtime/desktop/`. The Fiber HTTP server is a separate entry point; changing HTTP handlers alone does not update desktop behavior.

## Frontend locations

| Location | Responsibility |
| --- | --- |
| `src/app/mygo.ts` | Generated bridge types, service calls, and events. Source contracts are the bound Go services. Regenerate with the existing MyGo tooling when contracts change and remove optional generated explanatory comments afterward. |
| `src/app/native/bindings/mygo.legacy.ts` | Legacy bridge artifact. Inspect consumers before changing it; do not assume it is the active bridge. |
| `src/app/modules/player/Player.tsx` | View state: home, search, mix, lyrics, artist, liked, playlist, album, rewind. Persists page/scroll state with `wisewave-last-page`. |
| `src/app/modules/player/search/` | `SearchBox.tsx`, `SearchResults.tsx`, `searchCache.ts`; suggestion/result UI and bounded browser caches/inflight requests. |
| `src/app/modules/player/playback/` | `useMusic.ts` orchestrates playback/queue/state. Player bars, fullscreen artwork, canvas, progress styles, and equalizer settings live here. |
| `src/app/modules/player/catalog/` | Feed, artist, album, and provider playlist pages. |
| `src/app/modules/player/library/` | Local liked songs/playlists, collection views, menus, dialogs, and `useLibrary.ts`. Storage key: `wisewave-library`. Preserve stored schemas and migration handling. |
| `src/app/modules/player/listening/` | Listening UI, Rewind, history/charts, recording, client wrappers, formatting, and recap export. |
| `src/app/modules/player/lyric-view/` | Lyrics presentation, layout, motion, timing, and native renderer integration. `renderer/` contains the renderer runtime and declarations. |
| `src/app/modules/player/mini/` | Mini-player UI, synchronized with the native mini window. |
| `src/app/modules/player/shared/` | Track/artwork helpers, artist links, song menus, shortcuts, alerts, welcome UI. |
| `src/app/modules/settings/` | Settings UI and equalizer controls. Main settings persist under `wisewave-settings`. |
| `src/app/modules/accounts/`, `connection/` | Account controls and connection UI. |
| `src/app/shared/` | Shared UI, links, and zoom. Preserve accessible controls and existing storage synchronization. |
| `src/app/styles.css` | Shared application styling. Prefer scoped changes; check mini/fullscreen/settings views when changing shared selectors. |

## Native shell and desktop services

- `src/app/native/app.go`: stable public bootstrap entry. Keep its wrapper small.
- `src/app/native/windows/`: app window orchestration, mini-player, tray, startup preferences, and Windows/non-Windows tray menus. These remain together because they share window lifecycle state.
- `src/app/native/identity/`: platform application identity and Start Menu/COM integration. Preserve typed pointers and build tags.
- `src/app/native/system/`: clipboard and history export services. Preserve their MyGo service names and validation.
- `src/app/native/tokens/`: token engine and embedded `po_token.html`; keep the embed resource beside `engine.go`.
- `src/app/native/accounts/Spotify/`, `accounts/YouTube/`: provider-specific native login flows. `accounts/presentation/` owns shared window sizing and status HTML. Both login windows use 480 x 700, minimum 420 x 600, and maximum 560 x 820. Provider pages are untrusted, isolated ephemeral sessions. The YouTube login window stays hidden for the initial blank document, YouTube provider pages, and cookie hand-offs; show it only after a Google interaction page or WiseWave loading document finishes loading. Keep background throttling off during hidden session capture.
- `src/app/modules/accounts/Spotify/`, `accounts/YouTube/`: provider settings cards, login state, and library interfaces. Keep provider code out of the main Settings component. The YouTube provider displays as **YouTube Music** with its circular music icon.
- `src/app/modules/accounts/shared/`: shared status copy and accessible library dialog with focus management. Shared card and loading text must stay identical across providers apart from provider names. Preserve lowercase `waiting…` and `waiting for you…` and the `Bringing your music over` loading label. Library dialogs are portaled to the document body, centered on both axes, and must stack above the Settings overlay (11100 versus 11000). Keep the shared profile/stats/list layout and 8px import-button radius; YouTube uses red import buttons, the purple-pink liked-music artwork, and a single unfiltered collection list. Show playlist owners from provider metadata and actual account handles as `@username`; never substitute email addresses, channel IDs, or display names for handles.
- `src/runtime/desktop/music.go`: desktop music/search/catalog/lyrics/suggestions and `Audio.ServeHTTP`. `Music.Search` delegates through the YouTube client to the search engine.
- `playback.go`, `stream_reader.go`, `aac_decoder.go`, `equalizer.go`: native playback, decoding, stream reading, and equalization. Preserve codec fallbacks, seeking, synchronization, cancellation, and shutdown behavior.
- `audio_cache.go`: persistent bounded audio cache under the OS user cache directory, `WiseWave/audio`. Preserve its file validation, size limits, and atomicity.
- `listening.go`: wraps the existing listening store and privacy controls. `WireListeningSearch` in `music.go` reads preference snapshots from that same store; do not open a duplicate database just for search.
- `src/runtime/desktop/accounts/Spotify/`: Spotify account, protected session persistence, library synchronization, and track matching/import. Existing storage filenames, MyGo type names, and event names remain unchanged.
- `src/runtime/desktop/accounts/YouTube/`: account validation, DPAPI-protected `youtube-account.json`, atomic save, startup revalidation, and logout; `library.go` handles authenticated library/liked-music retrieval and imports by actual YouTube IDs.
- `src/runtime/desktop/accounts/storage/`: shared account-file path selection. `src/runtime/desktop/accounts.go` is the small adapter from the Music service to the YouTube account constructor.
- YouTube Music library synchronization is cancellable, scoped to the current account generation, and bounded by a timeout. Use the existing InnerTube browse/continuation implementation; never invent collection totals or metadata. Playlist imports are namespaced `youtube:` in the local library; preserve existing `spotify:` IDs.
- Library snapshots and status events contain metadata only. Cookies never enter frontend state or localStorage. Validate account identity before persisting credentials; a cookie's presence alone is insufficient.
- `media_session.go` and `discord.go` remain under `src/runtime/desktop/` for OS media controls and rich presence.
- Runtime YouTube authentication uses an atomic cookie-auth pointer and a single auth snapshot per API request. Preserve that concurrency behavior when changing login/logout or request construction. Browser cookie authentication applies only to WEB and WEB_REMIX requests; VisionOS and Android music requests must remain anonymous and retain visitor data. Sending browser credentials to those clients breaks stream resolution and timed lyrics.
- YouTube login must stay pending during Google password/consent/two-step-verification pages. Capture only after an exact HTTPS `music.youtube.com` return and a loaded page; signed-in identity must be verified by the authenticated account-menu response, not optional page configuration flags. Read `SESSION_INDEX` for account selection and `DELEGATED_SESSION_ID` for channel delegation; never use `DATASYNC_ID` as the delegated channel ID. Empty account responses during initialization remain pending briefly and then report a retryable verification failure. Google cookie hand-off navigation can include `www.google.com` and regional endpoints such as `accounts.google.co.in` / `www.google.co.in`; inspect blocked-host diagnostics before modifying login gating. Unknown hosts remain blocked and must surface a retryable sign-in error instead of silently waiting. Development login diagnostics may log phase labels and blocked hostnames only, never full redirect URLs, cookies, account details, or token values.

## Backend ownership

| Directory | Responsibility and invariants |
| --- | --- |
| `src/runtime/internal/search/` | Normalization, fuzzy matching, ranking, deduplication, candidate cache, and continuation/preference state. `search.go` owns retrieval orchestration; `cache.go` holds candidate cache data types; `state.go` owns bounded continuation state. Keep ranking independent of networking and do not invent metadata. |
| `internal/innertube/` | Existing YouTube backend. `client.go` adapts track search; `lookup.go` handles structured search/suggestions/continuations; `music.go` owns the HTTP client/context. `parser.go`, `json.go`, `items.go`, `credit.go` parse responses. Resolver/player/cipher/SABR files handle playable streams. Catalog/pages/playlist/queue/radio files handle browse operations. Account/session/saved/follow/ratings files handle identity and library interactions. |
| `internal/models/track.go` | Public track/album/playlist contracts and JSON tags. Preserve track IDs, artwork, durations, artist/album IDs, and response compatibility. Never fabricate unavailable fields. |
| `internal/handlers/` | Fiber adapters. `tracks.go` combines local and remote search; `music.go` serves structured browse/search; other files handle catalogs, streams, lyrics, discovery, and downloads. |
| `internal/cache/stream_cache.go` | Resolved playback URL cache. Separate from search and persistent audio caches; preserve expiration/invalidation behavior. |
| `internal/storage/catalog.go` | Local media indexing and library lookup. Map iteration order is not stable; sort explicitly when deterministic ranking depends on input order. |
| `internal/listening/` | SQLite store, schemas, heartbeat qualification, date ranges, history/insights. Search preference snapshots live in the existing query adapter. Respect private mode, qualified-play thresholds, database locking, retention, and closed-store behavior. |
| `internal/lyrics/` | Lyrics providers, service orchestration, TTML/LRC parsing, provenance. Preserve time units, provider attribution, and fallback behavior. |
| `internal/external/` | Existing Spotify, JioSaavn, and Gaana clients. Preserve source ID prefixes and existing explicit-source/fallback behavior. |
| `internal/downloader/` | Downloads and offline artifacts. Preserve validation, paths, and error cleanup. |
| `internal/secret/` | DPAPI on Windows and the non-Windows alternative. Preserve encryption/entropy/platform behavior; never replace protection with plaintext. |
| `internal/config/`, `internal/err/`, `internal/discord/` | Runtime config/DNS, friendly errors, and platform Discord transport. |

All `internal/` paths in this table are relative to `src/runtime/` unless fully specified.

## HTTP routes

The authoritative route registrations are in `src/runtime/app/server.go`. Prefix: `/api/v1`. Server binds to `127.0.0.1`; preserve localhost CORS and cross-site request protections. `PORT` defaults to `8080`, `MEDIA_DIR` to `./media`, and `ENV` to `development` in `internal/config/config.go`.

| Method | Routes | Handler area |
| --- | --- | --- |
| GET | `/health` | Runtime health/catalog count |
| GET | `/tracks`, `/tracks/:id`, `/albums` | Local catalog |
| GET | `/search`, `/popular`, `/radio` | Track search and discovery |
| POST | `/discover` | Discovery |
| GET | `/catalog/artists/:id`, `/catalog/albums/:id`, `/catalog/search`, `/catalog/new-releases` | Provider catalogs |
| GET | `/music/:kind/:id?` | Structured music/browse/search/suggestions |
| GET | `/saavn/search`, `/gaana/search` | Explicit existing providers |
| GET | `/spotify/search`, `/spotify/tracks/:id`, `/spotify/playlists/:id`, `/spotify/playlists` | Spotify adapters |
| POST | `/download` | Start download |
| GET | `/offline/tracks`, `/download/:id/audio`, `/download/:id/lyrics`, `/download/:id/bundle` | Offline artifacts |
| POST | `/rescan` | Rescan local media |
| GET | `/stream/:id`, `/resolve/:id`, `/artwork/:id`, `/lyrics` | Streaming, resolution, artwork, lyrics |

`handlers/music.go` supports kinds `home`, `explore`, `charts`, `moods`, `genres`, `new-releases`, `history`, `sponsorblock`, `search`, `suggestions`, `continue`, `artist`, `album`, `playlist`, `podcast`, `queue`, `related`, and `lyrics`. Search uses `q` and optional `continuation`; continuation requests can supply `q` to recover ranking when cached query state is unavailable. Do not confuse `/music/continue` browse pagination with search continuation handling.

## Search and data safety

- Keep title, artist, album, coverage, provider, and preference signals normalized. Exact textual matches must beat unrelated popular recordings. Preserve live, remix, acoustic, instrumental, remastered, slowed, sped-up, extended, and radio-edit distinctions.
- Deduplicate identical stable IDs. Merge different IDs only with sufficiently strong actual metadata; missing identity data is not permission to merge distinct recordings.
- Candidate cache: bounded per engine with a five-minute TTL and request coalescing. Preference snapshots are evaluated per request and must not be cached as personalized results.
- Continuation state: bounded, expiring, client-owned search state; preserve original queries and seen IDs. Do not leak query/seen state between clients. Unknown tokens without an original query cannot reconstruct that query; preserve API compatibility rather than inventing one.
- Preferences use repeated qualified listens over the recent history window, not popularity guesses. Private mode disables listening-history personalization. Never log cookies, credentials, playback URLs with secrets, or raw token payloads.
- Frontend result caches have separate lifetimes. Inspect `searchCache.ts` before assuming a backend ranking change immediately invalidates browser results.
- `Track` JSON uses snake_case, whereas structured music response fields can use camelCase. Preserve the existing bridge/API contracts instead of applying broad casing changes.
- Playback accepts YouTube IDs and existing provider prefixes. Inspect the relevant ID validators before changing routing/resolution. Never feed unvalidated paths into filesystem or stream operations.
- Preserve listening SQLite migrations and existing localStorage keys; do not delete user data or caches as a routine debugging step.

## Working and validation procedure

1. Read this guide, `git status --short`, and relevant source before editing. Inspect both desktop and HTTP entry points when changing backend behavior.
2. Follow the request across UI, bridge, desktop service, provider adapter, shared engine, and storage as applicable. Prefer a focused change at the owning layer.
3. Keep public signatures, JSON fields, MyGo events, persistent keys, platform build tags, embedded resource paths, and provider metadata intact unless changing them is explicitly required. Regenerate bridge declarations when bound contracts change.
4. Do not rewrite generated resources, installers, unrelated UI, dependencies, or caches without a task-specific reason. Keep licenses under `resources/licenses/` and `LICENSE` intact.
5. Format changed Go files with `gofmt -w`. Check whitespace with `git diff --check` and review the final diff for unintended changes and comments.
6. From the root run `go build ./...` and `go vet ./...`; separately run the same commands from `src/runtime/`. The nested module is not covered by root checks.
7. Run `npm run typecheck`; run `npm run build:web` when frontend/build assets change. Use `npm ci` when locked dependencies are absent. Report failures precisely and distinguish existing issues from introduced ones.
8. For relevant manual checks, use `npm run dev` for the desktop or `npm run dev:web` for Vite alone. Browser-only mode does not exercise native playback, MyGo, tray, DPAPI, or OS media integration. A server-only run uses `go run . --server` from the root and can index the configured media directory.
9. Packaging is `npx mygo build -platform windows/amd64,windows/arm64` per README. It requires the native tooling and NSIS; artifacts go to `dist/windows-amd64/` and `dist/windows-arm64/`. Do not build installers or regenerate binary assets for unrelated changes.
10. Report what changed, which checks actually ran, and any unresolved environment constraints. Never equate a successful build with a manual playback or UI check.

On this Windows workstation Go may be installed at `C:\Program Files\Go\bin\go.exe` and Node/npm under `C:\Program Files\nodejs\` even when absent from PATH. Use the installed executables or a process-local PATH; do not modify machine settings. Build caches and dependency installation may require the environment's normal approval mechanism.
