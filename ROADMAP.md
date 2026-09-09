# Nurevolution roadmap

Status: M0–M4 are implemented, merged, and covered by passing main CI. M5 repository delivery is implemented on `feat/m5-production-delivery`; host access and live deployment/restore evidence remain pending. M6–M9 implementation has not started. Public delivery and release checks remain pending.

Updated: 2026-09-09.

Inputs: [project bootstrap](docs/BOOTSTRAP.md), the owner's product answers dated 2026-09-06, M0/M1 decisions and audit dated 2026-09-07, M2/M3 implementation and M4 planning evidence dated 2026-09-08, and M4 implementation/mobile acceptance, merged review fixes, and M5 planning dated 2026-09-09.

This document defines outcomes, dependencies, and acceptance evidence from which to write implementation-grade milestone plans. M0 has audited the archive and frozen production feed; production infrastructure remains unaudited. Newer owner decisions recorded here take precedence over conflicting defaults in the bootstrap.

## 1. Product and release boundaries

Replace WordPress with a focused podcast player and complete episode archive. The website starts with a dark design, prominent artwork and audio controls, an episode list, and the selected episode's tracklist. There are no deadlines. The public GitHub repository also serves as a portfolio project.

### R1: WordPress retirement

These are the owner's five functional release requirements:

| ID           | Requirement                                                                                      | Acceptance evidence                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-FEED      | Complete, verified replacement RSS at `/feed/podcast`.                                           | Reconciled historical episode inventory; automated XML and metadata checks; successful external feed/client checks against the deployed replacement. |
| R1-PLAYER    | Enumerate every episode, show its artwork, and play its audio from beginning to end on the page. | Inventory-to-UI comparison, per-file integrity checks, browser playback tests, and deployed media delivery checks.                                   |
| R1-TRACKS    | Show each episode's available static, non-interactive tracklist.                                 | Imported tracklist reconciliation and correct rendering, including empty/untimed cases.                                                              |
| R1-DOWNLOAD  | Provide a working download link for every episode.                                               | Every link maps to the correct asset; actual download behavior and filenames checked in supported browsers.                                          |
| R1-SUBSCRIBE | Provide a visible link to the podcast RSS feed.                                                  | Keyboard-accessible link resolves to the production feed.                                                                                            |

Safe migration, accessibility, no automatic playback on page load, stable episode identity, verification, and working production operations remain engineering requirements. They do not turn every eventual player feature into a launch dependency.

Canonical episode URLs and play/pause-preserving selection are part of the initial player implementation. The 24-hour restore feature, richer controls, and interactive tracklists are planned separately so that the five functional release requirements stay explicit. The owner confirmed that drafts and scheduled publishing may follow the initial release.

### R2: Complete player and publishing workflow

Deliver the desired richer controls, track seeking/highlighting, local playback restoration, playback sequencing, and repository-based draft/scheduled publishing. These are intended work, not discarded ideas. At the R1 readiness checkpoint, the owner may choose to finish selected R2 work before production cutover; R1 is not automatically expanded.

### R3: Optional polish

Timestamp sharing, lock-screen controls, episode artwork and chapters in the feed, additional dark color choices, and unlisted previews may follow. A move from droplet-hosted audio to DigitalOcean Spaces can also be evaluated after release. The owner may reprioritize these individually after seeing their implementation cost.

### Explicit scope limits

- Do not recreate studio/soundsystem service pages, an about page, or contact information. Unknown retired service URLs need no special migration handling.
- No accounts, login, cross-device syncing, transcripts, or traditional CMS.
- No planned change to the domain, podcast identity, or directory listings. A new website visual identity does not imply changing feed branding.
- Analytics have not been requested; do not add tracking as part of launch.
- Do not make bulk MP3 storage part of Git history or the application image.

## 2. Evidence and migration assumptions

The owner has WordPress source, the database, episode MP3s, and artwork. Their supplied file listing contains **55 MP3 files**, totaling **6,767,918,690 bytes (about 6.30 GiB)**. The largest listed file is **286,927,439 bytes (about 273.64 MiB)**. These figures describe the supplied listing, not a verified episode count or complete storage requirement. Artwork, backups, runtime files, and future growth are additional.

The legacy database and feed supply tracklists but no start timestamps. Frozen M0 evidence derives 317 starts across 21 episodes from owner-supplied split-FLAC durations. During M2 planning, a hash-matched Praxis MP3 duration confirmed that its old duration metadata was stale; the [supplemental evidence](docs/milestones/evidence/M02-praxis-duration.json) supports 21 additional precise starts. M2 imports 338 starts across 22 episodes while preserving the frozen M0 record. Missing timing remains optional; never fabricate it or drop untimed tracks.

M0 reconciled all 55 published records with the frozen feed and files, including the distinct Mega 93.3 FM parts, with no missing/ambiguous episode matches or feed truncation. M2 preserves the agreed UTC publication evidence; filename dates and filesystem modification times remain unsuitable substitutes.

Local source locations are recorded in the [M0 source manifest plan](docs/milestones/M00-migration-audit.md#confirmed-decisions-and-entry-conditions). M0 verified file-backed artwork for every episode and both show images; no episode artwork bytes were found in the database. M2 consumes the public audit artifacts and the bounded Praxis correction without reopening the source audit or requiring private files in CI.

## 3. Product behavior contract

“Confirmed” means specified by the owner. “Proposed” is a concrete planning choice to validate when its milestone is planned. Open decisions are listed in section 4.

| Area                   | Required behavior                                                                                                                                                                                                                                          | Delivery                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Fresh page load        | Always initialize paused. Do not call play during initial load, hydration, state restoration, or opening a shared link. Confirmed.                                                                                                                         | R1 onward                              |
| Initial selection      | Without usable remembered state, select the newest published episode. Confirmed.                                                                                                                                                                           | R1 onward                              |
| Episode URLs           | Each episode has a directly addressable, indexable canonical URL. Proposed route shape: `/episodes/<stable-slug>`.                                                                                                                                         | R1                                     |
| URL precedence         | An explicitly requested episode takes precedence over remembered selection. Proposed: a matching remembered episode may restore position; another episode starts at zero.                                                                                  | R2 restoration                         |
| Episode selection      | Selecting a different episode starts at zero; continue playing only if playback was already active. Otherwise load paused. Confirmed.                                                                                                                      | R1                                     |
| Same-episode selection | Proposed: selecting the already selected episode preserves position/state; explicit restart remains separate.                                                                                                                                              | R1                                     |
| Client navigation      | Keep one player alive across internal navigation. Browser back/forward and selected-episode URL synchronization must not cause duplicate loads or competing audio. Selection continues playback only when it was already active.                           | R1                                     |
| History                | Proposed: user episode selections add a history entry; automatic advancement replaces it. Progress updates never create entries.                                                                                                                           | R1/R2                                  |
| Static tracklist       | Display available metadata in source order, with a timestamp when known. Missing lists and missing timestamps are valid.                                                                                                                                   | R1                                     |
| Track selection        | Seek to the chosen track's known start; continue only if already playing, otherwise remain paused. Confirmed. Untimed tracks remain readable and cannot seek.                                                                                              | R2                                     |
| Previous track         | More than three seconds into the current track: restart it. At or before three seconds: go to the previous navigable track. Confirmed. Proposed first-track boundary: restart the first track.                                                             | R2                                     |
| Track boundaries       | Proposed: track navigation stays within the episode; skip untimed entries; disable next-track at the final known start. Do not infer that episode wraparound also means track wraparound.                                                                  | R2                                     |
| Episode controls       | Previous always means older; next always means newer. Wrap at either end of the published archive. The direction toggle does not reverse these buttons. Confirmed.                                                                                         | R2                                     |
| Sequence direction     | At the end of active playback, automatically start another episode in the selected direction and wrap at archive boundaries. Offer newer-to-older and older-to-newer; default to newer-to-older. The toggle controls automatic sequencing only. Confirmed. | R2                                     |
| Seeking                | Provide seek bar and ±30-second controls, clamped to valid media bounds. Handle unknown duration and rejected seeks.                                                                                                                                       | R2; native seek may be available in R1 |
| Volume                 | Provide volume and mute controls where the browser supports them, without displaying a false state on platforms controlled by hardware volume.                                                                                                             | R2                                     |
| Remembered state       | On a visit within 24 hours, restore episode and position locally, always paused. After 24 hours without a page visit, discard that resume state and select the newest episode at zero. Confirmed.                                                          | R2                                     |
| Resume expiry detail   | Proposed: measure expiry from the last page visit, separately from throttled position writes; exactly 24 hours is expired. Do not expire a currently running player mid-session. Finalize tab/visit handling in M7's plan.                                 | R2                                     |
| Persistence boundary   | Proposed: remember the current episode/position only initially; no per-episode listening-history database. Invalid or unavailable storage falls back safely.                                                                                               | R2                                     |
| Active track           | Highlight based on current playback position when timestamps support it. Retain display-only behavior where they do not.                                                                                                                                   | R2                                     |
| Authoring              | Owner edits repository files. Drafts and scheduled releases are required after the initial release. Scheduling must affect all public surfaces consistently.                                                                                               | R2                                     |
| Themes/mobile          | Start dark; any later palette choices remain dark. Review working mobile alternatives before choosing a final layout.                                                                                                                                      | R1 design; R3 palette choices          |

Browser media errors or a rejected play request must leave honest, recoverable UI state. Preserving a user's active playback through a selection is different from initiating playback on a newly loaded page; neither persisted state nor URL parameters authorize play on load.

## 4. Decisions and discovery checkpoints

Only block work that depends on an unresolved answer. Foundational and migration planning can proceed while later player decisions remain open.

| ID  | Decision/status                                                           | Resolution, proposed direction, or required evidence                                                                                                                                                                                                                          | Applies to / needed before                             |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| D01 | Confirmed: paused track selection                                         | Seek to the chosen track's timestamp and stay paused; the zero-position rule applies to choosing an episode.                                                                                                                                                                  | M7 track-selection plan                                |
| D02 | Confirmed: automatic advancement and direction toggle                     | Auto-continue in the chosen direction, wrapping at archive boundaries; retain older/newer meanings for the manual buttons.                                                                                                                                                    | M7 sequencing plan                                     |
| D03 | Confirmed: publishing release placement                                   | Drafts and scheduled publishing may follow the initial release.                                                                                                                                                                                                               | M6 has no M8 dependency                                |
| D04 | Confirmed: audio hosting                                                  | Use DigitalOcean droplet storage and transfer for launch; evaluate DigitalOcean Spaces after release if useful.                                                                                                                                                               | M5 infrastructure implementation                       |
| D05 | Completed: source intake and M0 content mapping                           | M0 reconciled episodes, identities, enclosures, dates, tracklists, artwork, and legacy paths. Use its frozen public artifacts plus the documented M2 Praxis correction; preserve the separately supplied source files.                                                        | M0 intake; M2 full import and M3 compatibility signoff |
| D06 | Confirmed: mobile information layout                                      | Owner chose Episodes/Tracklist tabs on 2026-09-09 after working alternatives were provided. Desktop retains adjacent regions; the shared player remains mounted.                                                                                                              | M4 layout acceptance                                   |
| D07 | Automated baseline verified; physical-device/accessibility review pending | Chromium, Firefox, and WebKit from M1; 95% statement/line/function and 90% branch coverage. M4 keyboard/focus/reflow checks passed. Physical Android Chrome, iPhone Safari, and screen-reader observations remain preview/release checks; no complete WCAG conformance claim. | M4 interface checks; physical-device review before M6  |
| D08 | Size/base cost selected; remaining operations in discovery                | Owner plans a new $8/month Basic Premium Intel droplet: 1 vCPU, 1 GB RAM, 35 GB storage, 1 TB transfer. Record region/OS, other workloads, total budget, account access, domains, deployment trigger, traffic estimate, backup policy, and cutover owner in M5.               | Provisioning/deployment and M6 cutover                 |
| D09 | Publishing design: scheduling tolerance                                   | Proposed: timestamp with explicit UTC offset; server evaluates visibility; public cache delay bounded to at most 60 seconds.                                                                                                                                                  | M8 scheduling plan                                     |

D01-D04 were confirmed by the owner on 2026-09-06. On 2026-09-07 the owner confirmed complete local source intake for M0 and the full automated browser/coverage baseline for M1. On 2026-09-09 the owner selected the planned $8/month Basic Premium Intel tier in D08. Region, OS, shared workloads, and total cost including backups remain open; provisioning is unconfirmed. Remaining discovery and design details are resolved at the specified milestones.

## 5. Technical direction and boundaries

### Application and content

- Nuxt 4, TypeScript with strict checks, normal SSR/hybrid rendering, and client-side episode navigation.
- One canonical validated content model for UI, RSS, tracklists, audio references, artwork, and publication ordering.
- M2 uses one JSON file per immutable episode ID, separate show/assets/legacy-map files, and normalized safe HTML descriptions. This uses the short audited descriptions and existing JSON workflow; no Nuxt Content, YAML parser, or Markdown renderer is required.
- Episode model covers a stable internal identity, legacy GUID and its permalink semantics, stable slug, title, original publication instant, description, audio URL/MIME/byte length, artwork, duration if known, and optional ordered tracks. Optional track fields include artist, title, start seconds, label/release, and outbound links.
- Keep recording/mix date distinct from publication date if both exist. Episode ordering uses publication time with a deterministic tie-breaker.
- Store legacy URLs in a mapping, not in routing guesses. Keep feed GUIDs independent of new slugs, website branding, and storage location.
- Do not import the entire content collection into client code by default. Public endpoints and page payloads return only content eligible for publication. M8 extends this rule to scheduled content and drafts.
- Keep parsing, schema validation, publication filtering, ordering, navigation transitions, and feed serialization independently testable.
- Keep one persistent browser audio element behind a thin adapter; separate desired playback from confirmed browser state. No audio element on the server and no module-global listener state shared across SSR requests.
- Choose a plain-text/Markdown rendering boundary or sanitize imported HTML deliberately. Public WordPress content is still untrusted rendering input.

### Portable operations

Deployment target: a Nuxt/Nitro Node application on a shared DigitalOcean droplet, with audio stored on that droplet and served using its transfer allowance. Proposed packaging: a containerized application and reverse proxy for TLS/routing. Build and test through GitHub Actions, publish an immutable application image, and deploy that tested image. Keep audio on persistent storage independent of application releases.

Caddy is the proposed reverse proxy because it can obtain and renew public certificates, replacing the current pfSense certificate workflow for this site. Persist its certificate storage and prove an ACME challenge method works with the chosen Cloudflare/DNS/firewall configuration. This is a proposed implementation choice, not an already configured service. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

Cloudflare may front the website for caching and protection, but do not base podcast delivery on its free CDN carrying unrestricted large MP3 traffic. Its current application-service terms restrict disproportionate audio/large-file delivery without appropriate services. M5 must serve droplet-hosted audio through a topology that does not depend on that proxy. [Cloudflare CDN terms](https://www.cloudflare.com/service-specific-terms-application-services/)

Media delivery across releases:

| Stage                   | Approach                                                                          | Work to resolve                                                                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1, confirmed           | Media served directly by the droplet's web server from persistent disk.           | Budget outbound traffic, disk, backups, and shared-site capacity. Proposed: an unproxied media hostname with its own valid TLS certificate. Map legacy enclosure URLs deliberately; a cache-bypass rule alone does not remove traffic from Cloudflare's proxy. Account for public origin exposure. |
| After release, optional | Evaluate DigitalOcean Spaces if storage/transfer or operational needs justify it. | Compare actual cost and usage first. If chosen, migrate with checksums and validate range requests, downloads, caching, custom hostname, and old enclosure URLs. Keep provider-specific code out of the player.                                                                                    |

Owner-selected planning baseline on 2026-09-09: Basic Premium Intel at $8/month, 1 vCPU, 1 GB RAM, 35 GB storage, and 1 TB transfer; this supersedes the earlier $12/2 GiB candidate. Confirm the regional SKU and actual resources when provisioning. M5 must measure runtime needs within that shared 1 GB budget, reserve capacity for other sites, and retain disk headroom beyond the 6.34 GiB archive. Builds run in CI; one app instance is the default, with a brief measured replacement interval and the previous image retained for rollback. Outbound transfer above included allowance is currently $0.01/GiB; backups and other extras are outside the stated base price. [Droplet pricing](https://www.digitalocean.com/pricing/droplets), [bandwidth billing](https://docs.digitalocean.com/platform/billing/bandwidth/)

DigitalOcean Spaces is an object-storage service with an optional integrated CDN. It is a later evaluation, not a launch dependency or a reason to build a storage abstraction now. [DigitalOcean Spaces documentation](https://docs.digitalocean.com/products/spaces/)

Feed and media URLs must be usable by podcast clients without interactive browser challenges. Keep media transfer out of the Nuxt process where practical. The storage choice must preserve correct content length, type, HTTP HEAD, byte-range seeking, and useful download behavior.

## 6. Milestone sequence

M0–M3 are **implemented and locally verified**; M0–M2 also passed CI. M3 is on `feat/m3-podcast-rss`; M4–M9 implementation is **not started**. IDs are stable so later implementation plans can reference them.

Plans and completion evidence are available for [M0 — Migration audit](docs/milestones/M00-migration-audit.md) and [M1 — Foundation and verification](docs/milestones/M01-foundation-and-verification.md). The [M2 — Canonical content record](docs/milestones/M02-canonical-content.md) documents schemas, faithful import, protected edits, public data access, and completed acceptance checks. The [M3 — Replacement RSS record](docs/milestones/M03-podcast-rss.md) documents implemented metadata, serialization, aliases, cache behavior, compatibility tests, and the public validation handoff. Owner instructions are in the [content authoring guide](docs/CONTENT.md) and [feed validation guide](docs/FEED-VALIDATION.md).

| ID  | Outcome                                                          | Dependencies                                        | Release role                       |
| --- | ---------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------- |
| M0  | Reconciled migration inventory and compatibility contract        | Source access (D05)                                 | R1 prerequisite                    |
| M1  | Nuxt foundation and complete verification entry point            | None; use M0 samples when available                 | R1 prerequisite                    |
| M2  | Validated canonical archive and repeatable import                | M0, M1                                              | R1 prerequisite                    |
| M3  | Complete replacement RSS and compatibility tests                 | M2                                                  | R1 requirement                     |
| M4  | Accessible initial player, archive, and dark responsive UI       | M2; M3 for integrated feed acceptance               | R1 requirement                     |
| M5  | Tested deployment, media delivery, TLS, and rollback             | D04/D08; M1 build; M3/M4 for final rehearsal        | R1 prerequisite                    |
| M6  | Production cutover and verified WordPress retirement             | M0-M5                                               | R1 release                         |
| M7  | Interactive tracks, rich controls, sequencing, and restoration   | M4, D01, D02                                        | R2; may precede M6 by owner choice |
| M8  | Drafts and scheduled publishing                                  | M2/M3/M4 contracts; M5 for deployed acceptance; D09 | R2                                 |
| M9  | Selected sharing, feed, device, visual, and hosting enhancements | Relevant M3/M5/M7/M8 capabilities                   | R3; individually optional          |

M0 and M1 can progress independently. M3 and M4 share M2's model. Infrastructure design can start early, but M5 is not complete until the actual player/feed/media release has passed its deployment rehearsal. Numbering does not force M7/M8 to wait for production cutover.

### M0 — Inventory and migration contract

**Completed locally on 2026-09-07.** The audit reconciled all 55 database episodes, frozen feed items, MP3s, and episode artwork with no migration blockers. Two stale ACF byte-length fields remain documented as non-blocking because local, podPress, and enclosure sizes agree. See the [M0 completion record](docs/milestones/M00-migration-audit.md#completion-evidence-and-handoff--2026-09-07) and [migration compatibility contract](docs/migration/MIGRATION-AUDIT.md).

**Outcome:** know exactly what must survive the WordPress replacement.

**Deliverables:** migration report under `docs/`, a machine-readable episode/asset inventory, sanitized public-content fixtures, and a legacy URL/GUID compatibility map. Keep raw database dumps, source credentials, and private WordPress settings outside committed files.

**Scope:**

- Validate the separately supplied SQL dump, WordPress tree, and audio directory; investigate artwork files and possible database payloads, and capture the current public feed and its retrieval date.
- Compare all published podcast records with feed output and audio/artwork files; explain multipart episodes, duplicate records, missing references, and feed item limits.
- Identify podPress field encodings and tracklist formats. Preserve special characters and existing titles rather than deriving metadata from filenames.
- Record original GUID values plus `isPermaLink`, enclosure URLs/length/type, publication dates/timezones, show metadata, required namespace usage, artwork, descriptions, and original episode paths.
- Create a per-episode disposition table and exact expected published count. Document how episodes omitted from a truncated feed receive stable identities without changing existing ones.
- Discover traffic information useful for droplet sizing (D08), if available, without making historical analytics migration part of the product.

**Acceptance/verification:** every source episode has a documented disposition; every published episode maps to its audio/artwork or has a named blocking discrepancy; feed identity and legacy routing assertions are concrete. Record source checksums and a repeatable reconciliation procedure. Missing source access blocks the full audit, not M1 work with clearly labeled fixtures.

### M1 — Foundation and verification

**Completed locally on 2026-09-07.** After a clean frozen-lockfile install, `pnpm verify` passed: 14 application unit/runtime tests plus six M0 tooling unit tests, 100% statements/lines/functions/branches, both Node production builds, and 18 browser checks across Chromium, Firefox, and WebKit. The GitHub Actions workflow uses the same command; a remote run has not been triggered. See the [M1 completion record](docs/milestones/M01-foundation-and-verification.md#completion-evidence-and-handoff--2026-09-07) and [contributor instructions](README.md). M0 is complete, so both M2 prerequisites are available.

**Outcome:** a small, idiomatic Nuxt application whose meaningful changes can be checked consistently.

**Deliverables:** pinned tool/runtime versions, package lockfile, TypeScript configuration, basic app shell, Vitest/Nuxt test setup, Playwright setup, formatter/linter, GitHub Actions checks, contributor setup documentation, and the canonical `pnpm verify` command.

**Scope:**

- Confirm compatible current Nuxt/testing versions when implementing; justify added packages and avoid installing speculative player/CMS dependencies.
- Establish domain/server/client boundaries and the minimal HTMLAudioElement adapter test seam.
- Make the canonical command run formatting, lint, types, meaningful unit/integration tests and coverage, production build, and deterministic browser smoke tests. Extend its coverage as features arrive.
- Use a small local audio fixture with clear reuse rights for real browser smoke tests; controlled media events cover timing-dependent behavior.
- Configure pull-request checks with no deployment secrets exposed to untrusted contribution jobs. Publication/deployment work belongs in M5.

**Acceptance/verification:** a fresh checkout can install with the locked dependency graph and pass the documented canonical command; CI runs the same entry point; a test exercises actual behavior rather than importing configuration merely for coverage. Initial SSR and client hydration succeed without accessing browser media/storage on the server.

### M2 — Canonical content and complete archive

**Completed locally on 2026-09-08:** [M02-canonical-content.md](docs/milestones/M02-canonical-content.md#completion-evidence--2026-09-08). The canonical archive contains all 55 episodes, 832 tracks, 338 starts across 22 episodes, 156 assets, and 55 legacy mappings. JSON authoring, create-only imports, historical identity protections, and shared public content APIs are implemented. Praxis uses its verified duration and precise splits; one legacy track apostrophe is corrected with provenance, while the original M0 inputs remain unchanged. `pnpm verify` passed with 111 application/content tests, 12 migration tests, 25 browser checks, and coverage above the existing thresholds. Fresh installation/build and portable server-asset loading passed. M3 and M4 can consume the same public repository; no feed or player UI is claimed complete.

**Outcome:** the frontend and feed can consume the same complete, validated archive.

**Deliverables:** episode/show schemas, normalized domain model, canonical content files, repeatable import tooling, content validation, public-content access layer, asset manifest, and initial authoring instructions.

**Scope:**

- Select the authoring format from representative imported episodes, including long descriptions and partial/untimed tracks.
- Normalize timestamps to numeric seconds without discarding display metadata. Preserve original ordering for display; validate known start times as finite, nonnegative, and ordered, with a policy for duplicate starts and duration bounds.
- Keep the original GUID/permalink semantics, publication instant, enclosure metadata, and artwork associations. Distinguish absent optional information from invalid supplied information.
- Import deterministically and emit a reconciliation report; rerunning must not create duplicates or overwrite subsequent hand edits without an explicit reconciliation mode.
- Return the same published episode set and deterministic order to page/list/feed consumers. Archived source drafts remain excluded even before M8 adds new authoring workflows.
- Store media references and checked byte lengths, not MP3 blobs in Git. Record assets independently so media copies can be verified without re-encoding them.

**Acceptance/verification:** normalized published count and identities match M0; no unexplained discarded episodes, tracks, or descriptions; all artwork/audio references reconcile. Tests cover malformed content, duplicates, date/timezone handling, ordering ties, empty/untimed lists, escaping/sanitization, and public-content filtering. Import rerun evidence proves reproducibility. Run the canonical verification command.

### M3 — Replacement podcast RSS

**Completed and merged on 2026-09-08:** [M03-podcast-rss.md](docs/milestones/M03-podcast-rss.md#completion-evidence). PR [#2](https://github.com/treyturner/nurevolution.net/pull/2) was rebased and merged to `main` at `fc0f261`; [main CI passed](https://github.com/treyturner/nurevolution.net/actions/runs/34289605132). The complete 55-item RSS, verified show settings, both legacy aliases, GET/HEAD/304 behavior, stable weak ETags, and independent offline feed gate are implemented. A fresh merged-main `CI=1 pnpm verify` passed with 187 application tests, 12 migration tests, and 37 browser checks; coverage exceeds all existing thresholds. Historical episode/media identities and frozen source/report hashes remain unchanged. Public validator/client and media-delivery acceptance remain M5/M6 work; M4 can use the feed and must supply historical page redirects.

**Outcome:** produce the complete compatible podcast feed without WordPress or podPress at runtime.

**Deliverables:** independently testable RSS serializer, Nitro `/feed/podcast` route, public metadata compatibility assertions, route/header tests, and a feed validation checklist.

**Scope:**

- Generate RSS from M2's model, with correct namespaces, required show metadata, publication dates, item identity, enclosure URL/type/actual byte length, and properly escaped text.
- Preserve known episode GUIDs exactly, including permalink semantics. Retain existing enclosure URLs where the chosen infrastructure supports them; review unavoidable changes against M0 and test old paths.
- Return XML at the existing feed path, account for trailing-slash/legacy feed aliases discovered in M0, and avoid accidental HTML error pages or browser challenges.
- Define feed cache freshness and validators without deriving “last changed” from an arbitrary request clock. Keep this compatible with future scheduled visibility in M8.
- Omit optional episode artwork/chapters until M9 unless explicitly promoted; retain show artwork and any already-required feed fields.

**Acceptance/verification:** parse generated XML with an independent parser and assert semantic fields against the full canonical inventory and legacy fixtures. Cover XML metacharacters, dates, URL encoding, absent optional fields, duplicate GUIDs/enclosures, content type, and route behavior. A complete feed requires more than one successful sample item. Apple documents immutable GUIDs, enclosure URL/length/type, and HEAD/range-capable media delivery; use its current requirements when writing the validation checklist. [Apple podcast RSS requirements](https://podcasters.apple.com/support/823-podcast-requirements)

Run `pnpm verify`. External validator/client results are provisional until repeated against the public M5/M6 deployment; never report automated XML tests as directory acceptance.

### M4 — Initial archive player and responsive dark design

**Merged on 2026-09-09:** [PR #3](https://github.com/treyturner/nurevolution.net/pull/3), rebased main commit `77448fd`, with [passing main CI](https://github.com/treyturner/nurevolution.net/actions/runs/34308879714). The shared persistent native player, canonical SSR episode URLs, owner-selected mobile tabs, complete static tracklists, streaming attachment downloads, RSS link, and historical redirects are implemented. Review fixes cover encoded URLs, canonical paths, media error/continuation behavior, one live announcement, and byte-range-capable test media. Verification passed with 231 application tests, 12 migration tests, and 76 browser checks; thresholds and the two existing portability skips are unchanged. Canonical/source hashes still match. See [merged evidence](docs/milestones/M04-archive-player.md#merged-review-and-ci-evidence) and the [player guide](docs/PLAYER.md). Real-device/screen-reader observations and public delivery acceptance remain M5/M6 checks.

**Outcome:** satisfy R1's website requirements with the imported archive.

**Deliverables:** canonical episode pages, shared persistent player, episode list, artwork display, static tracklists, episode downloads, RSS link, minimal dark visual system, mobile prototype decision, and known legacy episode redirects.

**Scope:**

- Deliver the prominent art/player/list layout with readable metadata and minimal chrome. A native audio control can satisfy the initial player if accessible; custom rich controls belong to M7.
- Ensure all published episodes are discoverable; any pagination or loading strategy must retain complete archive access.
- On fresh page load select the requested episode or latest published episode, paused. Preserve active/paused playback across client-side episode selection and navigation.
- Synchronize canonical URL, selected episode, metadata, artwork, and tracklist. Do not replace the audio element on each route change.
- Display available tracklists without requiring timing or interactivity. Provide clear empty/loading/error states and recoverable media failures.
- Provide real download behavior, not merely an anchor whose `download` attribute is ignored by the chosen cross-origin media host. Use an appropriate media response/header strategy and verify filenames with punctuation.
- Use `/downloads/<saved-slug>` for same-origin attachment downloads in M4, streaming the canonical media with bounded resource use. M5 must retain that URL/filename contract when offloading downloads to the droplet's file-serving layer; playback and RSS enclosure URLs remain unchanged.
- Implement reasonable redirects from M0's known episode paths; unknown paths receive ordinary not-found behavior rather than guessed episode redirects.
- Let the owner try stacked and tabbed mobile layouts with real long titles/tracklists; record the chosen approach before finalizing.

**Acceptance/verification:** every R1 website requirement maps to a browser test or an archive-wide data/link check. Assert no play call on fresh load, hydration, direct episode links, or refresh. Test keyboard operation, focus visibility, responsive layouts, route back/forward, rapid episode changes, a failed media request, correct downloads, and SSR metadata. Use deterministic media controls plus a real short audio playback smoke test. Run `pnpm verify`; record manual device/accessibility observations and the mobile choice.

### M5 — Production delivery and operational rehearsal

**Plan written on 2026-09-09:** [M05-production-delivery.md](docs/milestones/M05-production-delivery.md) on `feat/m5-production-delivery`. It specifies packaging, manifests, file serving, CI publication/promotion, preview fidelity, rollback/restore, and acceptance evidence using the owner's selected $8/1 GB Premium Intel baseline. The owner confirmed Cloudflare-proxied website / DNS-only media routing, preview names, manual promotion, and MinIO backups after content changes and weekly with four weekly/three monthly retention. The droplet is not created and MinIO bucket/policy creation is deferred to handoff. Region/OS/workload/access, total cost, alerts, and live deployment/restore evidence remain pending. See [deployment operations](docs/DEPLOYMENT.md).

**Outcome:** a deployable, recoverable release on the chosen infrastructure, with media and HTTPS working independently of the home WordPress stack.

**Deliverables:** documented D04/D08 decisions and cost estimate; container/reverse-proxy configuration; media upload/verification process; GitHub Actions image publication and deployment workflow; preview environment; backup/restore, certificate, deployment, rollback, and incident runbooks.

**Scope:**

- Validate the selected 1 GB shared droplet's capacity for the application plus other planned sites. Build in CI, measure startup/runtime/maintenance peaks, reserve host headroom, and default to one app instance with a tested stop/start rollback procedure. Permit overlapping instances only if measured capacity supports them.
- Separate per-site configuration, resources, application networks, secrets, and release state. Sharing a droplet must not make a Nurevolution deploy restart other sites.
- Configure persistent droplet media storage, its hostname, and legacy enclosure routing. Copy assets with checksums; test correct types/lengths, HEAD, range responses, resume, and download headers for every mapped object. Serve original enclosure paths unchanged where possible; otherwise record and test the shortest compatible redirect to the unproxied media host, preserving GUIDs.
- Move certificate issuance/renewal for this site off pfSense. Persist ACME state; rehearse challenge issuance with a test environment and verify production renewal configuration and restart persistence.
- Define Cloudflare DNS/proxy/cache/security rules for the website and the selected media topology. Ensure feed/media clients can fetch without interactive challenges; avoid stale HTML/feed responses hiding releases.
- GitHub Actions must verify before publishing; deploy the tested image by immutable digest. Define the owner-selected release trigger, health checks, failure handling, and return to the previous image/configuration.
- Keep deployment credentials in appropriate secrets stores and production changes out of untrusted PR workflows. Document content/asset backups separately from recreatable app images.
- Record basic operational checks for availability, feed failures, storage/transfer usage, and certificate expiry; listener analytics remain outside scope.

**Acceptance/verification:** rehearse an actual deployment and application rollback in the preview environment; restore required persistent state from a backup; validate all media mappings and a representative full transfer; demonstrate working HTTPS after a restart; validate the feed externally and in a real podcast client. Record tested image digest, configuration version, media manifest, costs, and unresolved issues. Run canonical verification for code/config changes plus the documented environment checks.

### M6 — Cutover and WordPress retirement

**Outcome:** the public domain serves the verified replacement and existing subscribers retain their episode identities and audio access.

**Deliverables:** completed R1 acceptance matrix, final migration delta report, release record, cutover/rollback evidence, and WordPress retirement record.

**Scope:**

- Confirm whether WordPress received new episodes or edits during development; freeze authoring briefly or capture/reconcile a final delta before switching traffic.
- Present the R1 evidence and remaining R2/R3 work. The owner chooses whether to release now or include selected enhancements; do not silently turn polish into a blocker.
- Save the prior production configuration, content/feed snapshot, and media availability needed for rollback. Define rollback triggers, observation period, and responsible operator before cutover.
- Switch the required domain routing/deployment using the prepared runbook. Coordinate DNS/cache behavior and test from outside the origin environment.
- Recheck `/feed/podcast`, canonical/legacy episode URLs, show and episode artwork, all media links, download behavior, and actual podcast client playback/subscription behavior.
- Keep WordPress recoverable during the agreed observation period. Retire its running services once acceptance is confirmed; retain the agreed offline backups. Later feed/content changes must be included when evaluating a rollback to avoid dropping newly published episodes.

**Acceptance/verification:** all five R1 requirements have current production evidence, verification is green, no unexplained archive or identity differences remain, and no active service depends on WordPress, podPress, or home pfSense certificate renewal. Record any gaps explicitly rather than marking the milestone complete. Do not delete historical backups as part of normal retirement.

### M7 — Rich player, interactive tracklists, and restoration

**Outcome:** deliver the full application-like listening experience using the established player/model boundaries.

**Deliverables:** custom controls, interactive timed tracks, automatic highlighting, episode sequencing/direction control, and local 24-hour restoration. Implement as separately reviewable slices: restoration; seeking/volume; track navigation; episode sequencing.

**Scope:**

- Apply the confirmed D01/D02 decisions and turn section 3 into explicit transition tables before implementation. Separate user intent, browser media events, and route changes to avoid races.
- Add previous/next episode, previous/next track, ±30 seconds, play/pause, seek/progress, volume, and mute controls with accessible labels and state.
- Implement the exact three-second previous-track rule; handle missing/untimed tracks and boundaries without inventing timestamps.
- Implement the chosen direction-toggle semantics and episode wraparound, including a one-episode archive. Only already-active playback may continue automatically.
- Restore current episode/position within the 24-hour visit window, always paused. Resolve explicit route precedence, expiry boundary, position beyond changed duration, removed episodes, storage failure/corruption, and tab behavior.
- Seek after metadata is available; ignore stale responses/events after episode changes. Do not let a delayed play promise restart audio after a later pause.

**Acceptance/verification:** unit tests cover navigation tables, exactly/just before/just after three seconds, oldest/newest wrap, single/empty eligible collection, clamping, and timestamp gaps. Use a fake clock for the 24-hour boundary and fake media events for loading/error/race behavior. Browser tests cover paused versus active episode/track clicks, refresh restoration without play, route history, keyboard sliders, and unsupported volume behavior. Run `pnpm verify` and real-device media checks.

### M8 — Drafts and scheduled repository publishing

**Outcome:** the owner can prepare an episode, validate it, and publish now or at a specified time without editing independent website/feed copies.

**Deliverables:** authoring template/instructions, draft/publish metadata, scheduled visibility logic, publication validation, cache policy, and tested publication workflow.

**Scope:**

- Define explicit publication intent and a timestamp with timezone. Keep historical publication dates stable; invalid authoring input fails with actionable feedback.
- Drafts never appear on the public site/feed; future eligible episodes appear when due. Use one server-side publication predicate for lists, direct pages, RSS, sitemap if present, next/previous controls, and data endpoints.
- Do not ship drafts/future episode data through client bundles, Nuxt hydration payloads, or public collection endpoints. Scheduled content must be deployed ahead of time for the server to make it visible.
- Prefer server-time evaluation and bounded cache freshness over requiring a precisely timed GitHub Actions run. Resolve D09 and prove the transition occurs without a new deploy.
- Document asset upload/readiness before publication, validation, failed deploy handling, timezones, and correction of already-published metadata without changing GUIDs.
- Because the repository is public, committed draft source is publicly readable there. Draft means unpublished on the website/feed, not confidential; do not promise private previews or private media storage.

**Acceptance/verification:** fake-clock tests cover before/at/after publication time, timezone equivalence, drafts, invalid schedules, ordering changes, and feed/cache validators. Deployed tests confirm visibility within the agreed tolerance without a rebuild, no future/draft metadata in any public app response, and correct behavior after restart/rollback. Run `pnpm verify`; the owner can follow the instructions to prepare and schedule a test episode.

### M9 — Individually scoped polish

Each item gets its own bounded plan and acceptance checks; there is no requirement to deliver them as one large batch.

| Item                                          | Dependencies                    | Acceptance focus                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timestamp share links                         | M7 seeking and route precedence | Direct links load the specified position paused; malformed/out-of-bounds timestamps are handled; explicit timestamp overrides remembered position.                                          |
| Media Session integration                     | M7 player transitions           | Lock-screen/headset metadata and supported controls stay synchronized; unsupported browsers retain all normal controls.                                                                     |
| Per-episode feed artwork                      | M3 plus verified artwork assets | Correct optional feed fields and reachable compliant artwork without changing episode identities.                                                                                           |
| Feed chapters                                 | M3/M7 timed track model         | Generate a supported chapter format from canonical timed tracks, document omissions for untimed data, validate endpoints and client behavior.                                               |
| Additional dark palettes and brand refinement | M4 design feedback              | Accessible contrast/focus in every palette; no explicit light theme; respect reduced motion if motion is added.                                                                             |
| Optional track/artist/release links           | M2/M4 track presentation        | Validated safe links, accessible labels, and no interference with track seek interaction.                                                                                                   |
| Unlisted publicly reachable previews          | M8                              | Decide effort/value first; if implemented, exclude from ordinary listings/feed/indexing, keep unlisted status distinct from draft, and document that an unlisted URL is not private access. |
| Evaluate DigitalOcean Spaces                  | M5/M6 operational usage         | Compare droplet usage/cost with Spaces; migrate only if justified, verifying checksums, range/download behavior, legacy enclosure compatibility, and rollback while preserving GUIDs.       |

Directory submissions are a possible later owner task, not an automatic effect of deploying this website or modernizing the feed.

## 7. Verification and release evidence

### Canonical local/CI gate

Canonical command: **`pnpm verify`**, implemented and locally verified in M1. It covers formatting, lint, strict type checking, meaningful application unit/runtime tests with coverage, M0 tooling unit tests, production build, and deterministic Playwright checks. M2 adds canonical content validation, importer coverage, full-archive API checks, and production portability. M3 adds independent offline feed validation, serializer/HTTP tests, and built-feed/portability checks. CI uses the same gate rather than a divergent list of partial checks.

Owner-confirmed initial coverage thresholds for meaningful executable application logic: 95% statements/lines/functions and 90% branches, enforced from M1. Include UI/composable behavior where meaningful, not only pure utilities. Narrow declarative-config exclusions require a rationale; never lower established thresholds simply to pass CI.

Live network checks, production media audits, device checks, and directory/client validation are documented additional release evidence. Do not make ordinary deterministic tests depend on the availability of the WordPress site, remote MP3 hosts, or a third-party feed validator.

### Media evidence without fragile timing tests

- Reconcile and checksum every source/destination audio file; decode/scan full local files to detect truncation/corruption before launch, preserving originals rather than re-encoding by default.
- Validate every deployed enclosure's type/length and range support against the manifest. Include punctuation-heavy filenames, largest files, and any migrated redirects.
- Test real browser start/seek/pause/completion using a short local fixture; use controlled media events for long-duration transitions and error cases.
- Perform representative full-length production playback/download checks and podcast-client checks. Document the extent of sampling: simulated completion or a short fixture alone does not prove all production MP3s play end to end.
- Confirm no archive-wide audio preload and no unnecessary downloads of non-current media. Resize/lazy-load artwork appropriately and inspect mobile loading cost with real content.

### Milestone completion record

Every completed milestone records its implemented scope, important decisions, tests added/changed, exact verification command and result, coverage/build/browser summary, relevant manual/live evidence, and unresolved issues. A dependency is not complete merely because its document or test scaffold exists.

## 8. Turning milestones into implementation-grade plans

Create plans under `docs/milestones/`, for example `M02-canonical-content.md`, when that milestone is ready. Do not create speculative file-by-file plans for the whole project before M0 reveals the content and M1 establishes the code structure.

Each plan must contain:

1. **Outcome and requirement mapping:** milestone ID, linked R1/R2 behavior, entry conditions, and explicit non-goals.
2. **Current repository evidence:** actual files/modules/configuration, baseline verification result, existing changes to preserve, and source fixtures available.
3. **Resolved decisions:** links to D01-D09 as applicable, exact behavior tables, selected interfaces/schema shapes, and any still-blocking input.
4. **Bounded implementation steps:** concrete file targets based on repository inspection, responsibilities, task order, and small independently reviewable slices.
5. **Acceptance tests with inputs and expected results:** normal, boundary, failure, accessibility, migration, and publication cases relevant to the milestone. Name fixtures and which checks are automated versus manual.
6. **Validation commands and evidence:** canonical verification plus necessary import, deployment, media, or device checks; never substitute a partial test run for the canonical gate.
7. **Migration/rollout implications:** compatibility, cache/media/schema changes, reversibility, and rollback when the milestone affects deployed behavior.
8. **Completion and handoff:** decisions to preserve in repository documentation, remaining issues, exact completion evidence, and readiness for dependent milestones.

Update this roadmap when owner answers or discovered evidence change scope or dependencies. Keep confirmed decisions, proposed implementation choices, and unverified assumptions distinguishable throughout planning and delivery.
