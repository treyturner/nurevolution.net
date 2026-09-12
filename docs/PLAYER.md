# Archive player

Every episode URL selects an episode in the same shared interface. `/` selects the newest public episode; `/episodes/<saved-slug>` selects that episode. The layout and native audio element remain mounted during internal navigation. Artwork, artist/title, description, tracklist, source, and page metadata follow the accepted selection together.

## Listening and navigation

- Fresh loads, refreshes, and new tabs start at zero and stay paused. There is no local playback restoration in M4.
- Every selection loads the audio's metadata while staying paused unless playback was already active. “Loading audio…” remains until the browser has a finite, positive duration; then paused episodes show “Press Play to listen.” The player requests automatic preloading until metadata arrives and reduces it afterward. Ten seconds without loading progress triggers one automatic retry; another stall exposes “Retry audio”. Source changes and disposal cancel pending recovery.
- Selecting another episode starts it at zero. Active playback attempts to continue; paused playback stays paused. Selecting the current episode preserves its source, time, and playback state.
- Episode links add browser history entries. Back/Forward selects the addressed episode with the same active/paused rule. Progress never changes the URL.
- Native controls provide playback, seeking, and platform-supported volume. The selected episode stops at its natural end. Interactive tracks, custom controls, automatic sequencing, and remembered position remain M7.
- Where supported, `controlslist="nodownload noplaybackrate"` hides the native download and playback-speed options; the application supplies its own download links. Chromium's native volume slider stays expanded without hover. These native-control hints and styles are browser-dependent: Firefox and Safari retain their platform controls, including any browser-owned menus. They do not enforce playback speed outside the site's controls.
- A blocked continuation displays “Press Play to continue.” A media failure exposes “Retry audio”; retry reloads the source paused. An artwork failure leaves the player and content available with a labelled fallback.
- A media failure stops continuation even if the browser still reports active playback. A queued source-reset pause preserves the blocked-play prompt; a listener's pause cancels a pending start through the native `AbortError` outcome.
- Episode selection has one live announcement. The visible playback status is associated with the native audio control through its accessible description, without a second competing live region.
- Artwork opens its original image at native pixel dimensions in a modal dialog. Oversized images scroll inside the dialog; the close button stays at the viewport's top right. Outside clicks, the close button, and Escape dismiss it and return focus to the artwork trigger. The page behind the dialog is inert and cannot scroll. Changing episodes dismisses obsolete artwork without replacing the audio element or interrupting playback.
- All 55 imported episodes and 832 tracks are visible through the archive. Counts are derived from public content, without a fixed archive limit. Known track starts are display-only; unavailable tracklists are labelled explicitly.

The owner selected **Episodes/Tracklist tabs on mobile on 2026-09-09** after receiving working alternatives. Wider screens show adjacent regions. Tabs support arrow keys and Home/End, expose selection and panel relationships, and leave the player mounted. The comparison switch is removed.

## Data and lifecycle boundaries

`app/middleware/episode.ts` resolves the model before server rendering the shared layout. The application uses the existing public show/list/detail APIs and the server's publication predicate. Nuxt payload state supplies hydration, so it does not trigger another initial request or playback call.

`app/services/episode-page.ts` stages navigation independently of the displayed episode. Requests and route completion callbacks carry generation tokens; obsolete requests cannot overwrite the current model or cancel a newer stage for the same path. A failed selection leaves the prior route/player usable and offers retry. Explicit execution of keyed async data refreshes a revisited episode instead of silently reusing a previous successful response.

`app/services/audio.ts` adapts one existing element and exposes its actual snapshot/events. `app/services/player.ts` owns source transitions and playback-promise generations. Browser `play()` makes a pending playback request observable through `paused`; loading a new source and attempting continuation happen together. Queued source-change pause events are ignored while the current element is playing and cannot erase a blocked continuation. Native rejection reasons distinguish a user-cancelled start from blocked playback. Source changes, media failures, and disposal invalidate obsolete play callbacks. `usePodcastPlayer` binds only after mount and disposes the adapter with its owning component.

Server rendering never constructs browser media objects. Application state is per Nuxt application/request, and the audio element sits outside the changing page. Native time and volume changes are not duplicated into a second control system. Description HTML comes only from the existing canonical sanitizer; ordinary text uses escaped bindings.

## Downloads and old links

Each episode has a `/downloads/<saved-slug>` link. The endpoint resolves a public episode, fetches its exact canonical HTTPS URL on `podcast.nurevolution.net`, validates status/type/length/encoding, and serves an attachment with the canonical raw basename. It supplies both quoted ASCII and UTF-8 filename parameters, preserving punctuation such as the apostrophe in `bouche_d'incendie`.

The application endpoint supports GET and HEAD; other methods return 405. Unknown or nonpublic slugs return 404 before fetching media. It accepts no request-supplied upstream URL, credentials, filename, or forwarded cookies/authorization. Redirects are rejected. Upstream header waiting is bounded to ten seconds; a healthy full download has no short total-duration timeout. The response uses `no-store` and does not advertise ranges; Range requests receive the complete 200 representation. Playback and RSS retain the original direct media URLs.

The response service streams chunks and verifies the final byte count. The Node handler uses `Readable.fromWeb` and `pipeline` for backpressure and cancellation; H3 v1's default web-stream bridge does not wait for `write()` backpressure. A client disconnect cancels upstream work. Invalid upstream metadata produces a plain 502/504 before success headers; a failed body terminates the connection without appending an error document.

All 55 known `/podcast/...` paths and their single trailing-slash variants redirect with 301 to the saved episode path. Redirects use the shared publication predicate and drop legacy query parameters. Unknown paths are 404; no title/GUID-derived guesses are made. Existing RSS aliases remain in place.

## Verification and deployment handoff

Run **`CI=1 pnpm verify`** for the canonical gate. Focused player/controller, Nuxt presentation/routing, download/redirect, and built-browser tests are also available through the existing Vitest and Playwright commands.

Tests reconcile every episode's SSR metadata/artwork/list/download links and all 832 rendered tracks, every historical redirect, and the complete feed. Browser scenarios cover no initial autoplay, element persistence, active/paused selection, Back/Forward, rapid/stale requests, failed navigation, media retry, responsive tabs, keyboard focus, MP3 decoding/natural completion, and actual attachment saves. Controlled media races remain unit tests; browser integration uses original small fixtures and the production components/streaming handler. CI makes no requests for the large public MP3 bodies and needs no private WordPress files.

The [fixture guide](../test/fixtures/media-app/README.md) records generation and hashes. The [M4 plan and completion record](milestones/M04-archive-player.md) records actual verification and the preserved source/canonical hashes.

M5 implements edge offloading of `/downloads/<slug>` through a 307 to the DNS-only media hostname. The attachment response uses `application/octet-stream` so WebKit saves redirected MP3s, with the exact filename and bytes; playback/RSS retain `audio/mpeg`. Local Caddy/browser delivery checks pass; the application streaming handler remains the development fallback. See [deployment operations](DEPLOYMENT.md). Verify every media mapping/type/length, HEAD, ranges/resume, a representative full transfer, and browser saves against the deployed configuration. Preserve enclosure URLs and `/wp/wp-content/uploads/...` artwork until the replacement serves those paths. M8 must review scheduled visibility across page data, redirects, download mappings, and caches.

Real Android Chrome, iPhone Safari, and screen-reader observations remain explicit preview/release checks. Headless Chromium/Firefox/WebKit and viewport tests do not establish physical-device compatibility or complete WCAG conformance. Public TLS, external podcast-client/validator checks, backup/rollback, and WordPress retirement remain M5/M6.
