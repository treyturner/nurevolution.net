# nurevolution roadmap

Status: M0–M4 are implemented and merged. M5 delivery, rollback, capacity, and independent recovery are rehearsed. [M6](docs/milestones/M06-cutover-and-retirement.md) is **closed as of 2026-09-18**: the owner confirmed retirement of the legacy site/database and their backups, accepted the observation outcome and a four-hour recovery target, and separated Safari 14.3 work from M6. Production is the only hosted environment; development uses local/workspace servers. [M7 player enhancements](docs/milestones/M07-rich-player-and-restoration.md) and subsequent UI refinements are implemented and released. [Verified promotion runs](https://github.com/treyturner/nurevolution.net/actions/workflows/deploy.yml) record actual deployments. M8–M9 remain future work. On 2026-09-18 the owner moved listening/feed enhancements ahead of drafts/scheduling; [M8 scope](docs/milestones/M08-listening-and-feed-enhancements.md) now contains five bounded areas.

Updated: 2026-09-18.

**Current acceptance update:** the owner completed loading and seeking for every episode in Podcast Addict and enabled Dependabot security alerts. Assistive-technology checks are owner-deferred future enhancement work, not a WordPress-retirement gap. The available iPad Pro running iPadOS 14.3 renders the site but does not initialize playback; the import-map startup dependency requires newer Safari. Headscale/firewall startup, backup tools, and weekly scheduling also passed the owner-managed Unraid reboot check. The owner then confirmed legacy retirement/backups and accepted M6 closure with a four-hour recovery target; Safari 14.3 work remains separate. These observations supersede older pending descriptions below. See the [September 18 acceptance record](docs/operations/acceptance-2026-09-18.md) for scope and diagnostic limits.

Inputs: [project bootstrap](docs/BOOTSTRAP.md), the owner's product answers dated 2026-09-06, M0/M1 decisions and audit dated 2026-09-07, M2/M3 implementation and M4 planning evidence dated 2026-09-08, M4 implementation/mobile acceptance and M5 planning dated 2026-09-09, M5 live/recovery evidence dated 2026-09-11, and merged preview refinements plus M6 readiness inspection dated 2026-09-12.

This document defines outcomes, dependencies, and acceptance evidence from which to write implementation-grade milestone plans. M0 audited the archive and froze the production feed; M5 records the provisioned candidate infrastructure and live rehearsal. M6 records the reconciled legacy archive, completed production cutover, and owner-accepted retirement/closure. Newer owner decisions recorded here take precedence over conflicting defaults in the bootstrap.

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

### R3: Listening enhancements and deferred polish

The owner prioritized timestamp sharing, lock-screen/headset controls, episode artwork and chapters in the feed, and Safari 14.3 compatibility as the new M8, ahead of M9 drafts/scheduling. Additional dark palettes and track/artist/release links are explicitly deferred. Unlisted previews and a possible move from droplet-hosted audio to DigitalOcean Spaces remain separately scoped possibilities, not M8 completion requirements.

### Explicit scope limits

- Do not recreate studio/soundsystem service pages, an about page, or contact information. Unknown retired service URLs need no special migration handling.
- No accounts, login, cross-device syncing, transcripts, or traditional CMS.
- No planned change to the domain, podcast identity, or directory listings. A new website visual identity does not imply changing feed branding.
- Analytics have not been requested; do not add tracking as part of launch.
- Do not make bulk MP3 storage part of Git history or the application image.

## 2. Evidence and migration assumptions

The owner has WordPress source, the database, episode MP3s, and artwork. Their supplied file listing contains **55 MP3 files**, totaling **6,767,918,690 bytes (about 6.30 GiB)**. The largest listed file is **286,927,439 bytes (about 273.64 MiB)**. These figures describe the supplied listing, not a verified episode count or complete storage requirement. Artwork, backups, runtime files, and future growth are additional.

The legacy database and feed supply tracklists but no start timestamps. Frozen M0 evidence derives 317 starts across 21 episodes from owner-supplied split-FLAC durations. During M2 planning, a hash-matched Praxis MP3 duration confirmed that its old duration metadata was stale; the [supplemental evidence](docs/milestones/evidence/M02-praxis-duration.json) supports 21 additional precise starts. M2 imports 338 starts across 22 episodes while preserving the frozen M0 record. Later authored cues bring the current catalog to 626 timed tracks across 34 episodes; sixteen guest tracklists remain untimed and five episodes lack lists. See [current status](docs/STATUS.md#archive-completeness). Missing timing remains optional; never fabricate it or drop untimed tracks.

M0 reconciled all 55 published records with the frozen feed and files, including the distinct Mega 93.3 FM parts, with no missing/ambiguous episode matches or feed truncation. M2 preserves the agreed UTC publication evidence; filename dates and filesystem modification times remain unsuitable substitutes.

Local source locations are recorded in the [M0 source manifest plan](docs/milestones/M00-migration-audit.md#confirmed-decisions-and-entry-conditions). M0 verified file-backed artwork for every episode and both show images; no episode artwork bytes were found in the database. M2 consumes the public audit artifacts and the bounded Praxis correction without reopening the source audit or requiring private files in CI.

## 3. Product behavior contract

“Confirmed” means specified by the owner. M7 behavior below includes the later UI decisions; the [player guide](docs/PLAYER.md) is the detailed released behavior reference. “Proposed” applies only to remaining planned work. Open decisions are listed in section 4.

| Area                   | Required behavior                                                                                                                                                                                                                | Delivery                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Fresh page load        | Always initialize paused. Do not call play during initial load, hydration, state restoration, or opening a shared link. Confirmed.                                                                                               | R1 onward                              |
| Initial selection      | Without usable remembered state, select the newest published episode. Confirmed.                                                                                                                                                 | R1 onward                              |
| Episode URLs           | Each episode has a directly addressable, indexable canonical URL at `/episodes/<stable-slug>`.                                                                                                                                   | R1                                     |
| URL precedence         | An explicit episode takes precedence over remembered selection. A matching saved episode may restore position; another explicit episode starts at zero.                                                                          | R2 restoration                         |
| Episode selection      | A different episode starts at zero. While playing/buffering, manual changes ask for confirmation; acceptance attempts to continue playback. Paused changes stay paused.                                                          | R1                                     |
| Same-episode selection | Selecting the current episode preserves its source, position, and playback state.                                                                                                                                                | R1                                     |
| Client navigation      | Keep one player alive across internal navigation. Browser back/forward and selected-episode URL synchronization must not cause duplicate loads or competing audio. Selection continues playback only when it was already active. | R1                                     |
| History                | User episode selections add a history entry; automatic advancement replaces it. Progress updates never create entries.                                                                                                           | R1/R2                                  |
| Static tracklist       | Display available metadata in source order. Default to track durations; “Show: Timestamp” switches to start times. Unknown timing and missing lists remain valid.                                                                | R1                                     |
| Track selection        | Selecting the current track toggles Play/Pause at the current position. Another timed track seeks to its start, preserving paused/playing intent. Untimed rows cannot seek.                                                      | R2                                     |
| Previous track         | More than three seconds into the current track restarts it; at three seconds or less, go to the preceding known start. At the first track, restart that first start.                                                             | R2                                     |
| Track boundaries       | Track navigation stays within the episode, skips untimed entries, and disables Next at the final known start.                                                                                                                    | R2                                     |
| Episode controls       | Previous moves up the displayed episode list; Next moves down. Both wrap. Confirmed in the M7 interface review on 2026-09-13.                                                                                                    | R2                                     |
| Sequence direction     | Automatic playback moves down the displayed list and wraps. The text button toggles “Sort: Newest” (default) / “Sort: Oldest”. Before any playback, an unplayed top selection follows the new top when flipped.                  | R2                                     |
| Seeking                | Provide seek bar and ±30-second controls, clamped to valid media bounds. Handle unknown duration and rejected seeks.                                                                                                             | R2; native seek may be available in R1 |
| Volume                 | Provide volume and mute controls where the browser supports them, without displaying a false state on platforms controlled by hardware volume.                                                                                   | R2                                     |
| Remembered state       | On a visit within 24 hours, restore episode and position locally, always paused. After 24 hours without a page visit, discard that resume state and select the newest episode at zero. Confirmed.                                | R2                                     |
| Resume expiry detail   | Measure expiry from the last document visit, separately from throttled position writes; exactly 24 hours is expired. Do not expire an active mounted session.                                                                    | R2                                     |
| Persistence boundary   | Remember only the current episode/position and visit/activity timing, with no per-episode history database. Invalid or unavailable storage falls back safely.                                                                    | R2                                     |
| Active track           | Highlight based on current playback position when timestamps support it. Retain display-only behavior where they do not.                                                                                                         | R2                                     |
| Authoring              | Owner edits repository files. Drafts and scheduled releases are required after the initial release. Scheduling must affect all public surfaces consistently.                                                                     | R2                                     |
| Themes/mobile          | Dark design; later palettes remain dark. The owner selected Episodes/Tracklist tabs for mobile; desktop retains adjacent lists.                                                                                                  | R1 design; R3 palette choices          |

Browser media errors or a rejected play request must leave honest, recoverable UI state. Preserving a user's active playback through a selection is different from initiating playback on a newly loaded page; neither persisted state nor URL parameters authorize play on load.

## 4. Decisions and discovery checkpoints

Only block work that depends on an unresolved answer. Foundational and migration planning can proceed while later player decisions remain open.

| ID  | Decision/status                                    | Resolution, proposed direction, or required evidence                                                                                                                                                                                                                                                  | Applies to / needed before                             |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| D01 | Confirmed: track selection                         | A different timed track seeks while preserving paused/playing intent. Selecting the current track toggles Play/Pause at the current position, per the later owner refinement.                                                                                                                         | Released M7 behavior                                   |
| D02 | Confirmed: list sort drives episode navigation     | “Sort: Newest” / “Sort: Oldest” toggles list order. Next/automatic go down and Previous goes up; an unplayed top selection follows the new top before playback has ever begun.                                                                                                                        | Released M7 behavior                                   |
| D03 | Confirmed: publishing release placement            | Drafts and scheduled publishing may follow the initial release.                                                                                                                                                                                                                                       | M6 has no M9 dependency                                |
| D04 | Confirmed: audio hosting                           | Use DigitalOcean droplet storage and transfer for launch; evaluate DigitalOcean Spaces after release if useful.                                                                                                                                                                                       | M5 infrastructure implementation                       |
| D05 | Completed: source intake and M0 content mapping    | M0 reconciled episodes, identities, enclosures, dates, tracklists, artwork, and legacy paths. Use its frozen public artifacts plus the documented M2 Praxis correction; preserve the separately supplied source files.                                                                                | M0 intake; M2 full import and M3 compatibility signoff |
| D06 | Confirmed: mobile information layout               | Owner chose Episodes/Tracklist tabs on 2026-09-09 after working alternatives were provided. Desktop retains adjacent regions; the shared player remains mounted.                                                                                                                                      | M4 layout acceptance                                   |
| D07 | Accepted with documented device/client limitations | Automated browser, keyboard/focus/reflow, and owner Android Brave evidence retained. All 55 episodes loaded/sought in Podcast Addict. Safari 14.3 is a separate compatibility fix; current physical Safari remains untested; assistive checks are owner-deferred. No complete WCAG conformance claim. | Post-M6 compatibility/enhancement work                 |
| D08 | Host provisioned; M6 operational acceptance closed | Existing NYC1 host, backup policy, component restores, and boot persistence accepted. Owner accepted a four-hour recovery target on 2026-09-18; replacement-host duration is unmeasured. Total cost/capacity review remains ongoing operations; no new purchase or spending ceiling approved.         | Routine operations after M6                            |
| D09 | Publishing design: scheduling tolerance            | Proposed: timestamp with explicit UTC offset; server evaluates visibility; public cache delay bounded to at most 60 seconds.                                                                                                                                                                          | M9 scheduling plan                                     |

D01-D04 were confirmed by the owner on 2026-09-06. On 2026-09-07 the owner confirmed complete local source intake for M0 and the full automated browser/coverage baseline for M1. On 2026-09-09 the owner selected the planned $8/month Basic Premium Intel tier in D08. Ubuntu 26.04 LTS x64 is confirmed. Other sites are future work and do not gate M5. The NYC1 droplet is provisioned with verified SSH access. Total cost including backups remains a routine operations review item, outside closed M6. Remaining discovery and design details are resolved at the specified milestones.

## 5. Technical direction and boundaries

### Application and content

- Nuxt 4, TypeScript with strict checks, normal SSR/hybrid rendering, and client-side episode navigation.
- One canonical validated content model for UI, RSS, tracklists, audio references, artwork, and publication ordering.
- M2 uses one JSON file per immutable episode ID, separate show/assets/legacy-map files, and normalized safe HTML descriptions. This uses the short audited descriptions and existing JSON workflow; no Nuxt Content, YAML parser, or Markdown renderer is required.
- Episode model covers a stable internal identity, legacy GUID and its permalink semantics, stable slug, title, original publication instant, description, audio URL/MIME/byte length, artwork, duration if known, and optional ordered tracks. Optional track fields include artist, title, start seconds, label/release, and outbound links.
- Keep recording/mix date distinct from publication date if both exist. Episode ordering uses publication time with a deterministic tie-breaker.
- Store legacy URLs in a mapping, not in routing guesses. Keep feed GUIDs independent of new slugs, website branding, and storage location.
- Do not import the entire content collection into client code by default. Public endpoints and page payloads return only content eligible for publication. M9 extends this rule to scheduled content and drafts.
- Keep parsing, schema validation, publication filtering, ordering, navigation transitions, and feed serialization independently testable.
- Keep one persistent browser audio element behind a thin adapter; separate desired playback from confirmed browser state. No audio element on the server and no module-global listener state shared across SSR requests.
- Choose a plain-text/Markdown rendering boundary or sanitize imported HTML deliberately. Public WordPress content is still untrusted rendering input.

### Portable operations

Deployment target: a Nuxt/Nitro Node application on a shared DigitalOcean droplet, with audio stored on that droplet and served using its transfer allowance. Proposed packaging: a containerized application and reverse proxy for TLS/routing. Build and test through GitHub Actions, publish an immutable application image, and deploy that tested image. Keep audio on persistent storage independent of application releases.

Caddy is the deployed reverse proxy. Its persisted certificates use Cloudflare DNS-01 and automatic renewal, replacing the pfSense certificate workflow for this site. Trusted issuance, recovery, and droplet reboot checks passed. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

Cloudflare may front the website for caching and protection, but do not base podcast delivery on its free CDN carrying unrestricted large MP3 traffic. Its current application-service terms restrict disproportionate audio/large-file delivery without appropriate services. M5 must serve droplet-hosted audio through a topology that does not depend on that proxy. [Cloudflare CDN terms](https://www.cloudflare.com/service-specific-terms-application-services/)

Media delivery across releases:

| Stage                   | Approach                                                                          | Work to resolve                                                                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1, confirmed           | Media served directly by the droplet's web server from persistent disk.           | Budget outbound traffic, disk, backups, and shared-site capacity. Proposed: an unproxied media hostname with its own valid TLS certificate. Map legacy enclosure URLs deliberately; a cache-bypass rule alone does not remove traffic from Cloudflare's proxy. Account for public origin exposure. |
| After release, optional | Evaluate DigitalOcean Spaces if storage/transfer or operational needs justify it. | Compare actual cost and usage first. If chosen, migrate with checksums and validate range requests, downloads, caching, custom hostname, and old enclosure URLs. Keep provider-specific code out of the player.                                                                                    |

Owner-selected planning baseline on 2026-09-09: Basic Premium Intel at $8/month, 1 vCPU, 1 GB RAM, 35 GB storage, and 1 TB transfer; this supersedes the earlier $12/2 GiB candidate. Confirm the regional SKU and actual resources when provisioning. M5 must measure nurevolution and host-service runtime needs within the 1 GB budget, document remaining headroom, and retain disk headroom beyond the 6.34 GiB archive. Assess additional sites when they are added. Builds run in CI; one app instance is the default, with a brief measured replacement interval and the previous image retained for rollback. Outbound transfer above included allowance is currently $0.01/GiB; backups and other extras are outside the stated base price. [Droplet pricing](https://www.digitalocean.com/pricing/droplets), [bandwidth billing](https://docs.digitalocean.com/platform/billing/bandwidth/)

DigitalOcean Spaces is an object-storage service with an optional integrated CDN. It is a later evaluation, not a launch dependency or a reason to build a storage abstraction now. [DigitalOcean Spaces documentation](https://docs.digitalocean.com/products/spaces/)

Feed and media URLs must be usable by podcast clients without interactive browser challenges. Keep media transfer out of the Nuxt process where practical. The storage choice must preserve correct content length, type, HTTP HEAD, byte-range seeking, and useful download behavior.

## 6. Milestone sequence

M0–M4 are **implemented and merged**. M5 is **implemented with live rehearsal evidence**. M6 is **closed on 2026-09-18**; production is active and the legacy site/database are retired. M7 is **implemented and released**; M8 implementation is underway and M9 has not started. M0–M7 IDs remain stable. On 2026-09-18 the owner swapped the two then-unstarted milestones: selected former M9 enhancements are now M8; former M8 drafts/scheduling is now M9. Historical milestone plans retain their original numbering.

Plans and completion evidence are available for [M0 - Migration audit](docs/milestones/M00-migration-audit.md) and [M1 - Foundation and verification](docs/milestones/M01-foundation-and-verification.md). The [M2 - Canonical content record](docs/milestones/M02-canonical-content.md) documents schemas, faithful import, protected edits, public data access, and completed acceptance checks. The [M3 - Replacement RSS record](docs/milestones/M03-podcast-rss.md) documents implemented metadata, serialization, aliases, cache behavior, compatibility tests, and the public validation handoff. Owner instructions are in the [content authoring guide](docs/CONTENT.md) and [feed validation guide](docs/FEED-VALIDATION.md).

| ID  | Outcome                                                              | Dependencies                                        | Release role                           |
| --- | -------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------- |
| M0  | Reconciled migration inventory and compatibility contract            | Source access (D05)                                 | R1 prerequisite                        |
| M1  | Nuxt foundation and complete verification entry point                | None; use M0 samples when available                 | R1 prerequisite                        |
| M2  | Validated canonical archive and repeatable import                    | M0, M1                                              | R1 prerequisite                        |
| M3  | Complete replacement RSS and compatibility tests                     | M2                                                  | R1 requirement                         |
| M4  | Accessible initial player, archive, and dark responsive UI           | M2; M3 for integrated feed acceptance               | R1 requirement                         |
| M5  | Tested deployment, media delivery, TLS, and rollback                 | D04/D08; M1 build; M3/M4 for final rehearsal        | R1 prerequisite                        |
| M6  | Production cutover and verified WordPress retirement                 | M0-M5                                               | R1 release                             |
| M7  | Interactive tracks, rich controls, sequencing, and restoration       | M4, D01, D02                                        | R2; may precede M6 by owner choice     |
| M8  | Listening and feed enhancements, including Safari 14.3 compatibility | M3/M4/M7 contracts; existing M5 delivery            | Selected R3 scope, five required areas |
| M9  | Drafts and scheduled publishing                                      | M2/M3/M4 contracts; M5 for deployed acceptance; D09 | R2                                     |

M0 and M1 can progress independently. M3 and M4 share M2's model. Infrastructure design can start early, but M5 is not complete until the actual player/feed/media release has passed its deployment rehearsal. The original sequencing allowed M7 and publishing work to precede production cutover. M6 is now closed; M8 does not depend on M9.

### M0 - Inventory and migration contract

**Completed locally on 2026-09-07.** The audit reconciled all 55 database episodes, frozen feed items, MP3s, and episode artwork with no migration blockers. Two stale ACF byte-length fields remain documented as non-blocking because local, podPress, and enclosure sizes agree. See the [M0 completion record](docs/milestones/M00-migration-audit.md#completion-evidence-and-handoff---2026-09-07) and [migration compatibility contract](docs/migration/MIGRATION-AUDIT.md).

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

### M1 - Foundation and verification

**Completed locally on 2026-09-07.** After a clean frozen-lockfile install, `pnpm verify` passed: 14 application unit/runtime tests plus six M0 tooling unit tests, 100% statements/lines/functions/branches, both Node production builds, and 18 browser checks across Chromium, Firefox, and WebKit. The GitHub Actions workflow uses the same command; a remote run has not been triggered. See the [M1 completion record](docs/milestones/M01-foundation-and-verification.md#completion-evidence-and-handoff---2026-09-07) and [contributor instructions](docs/CONTRIBUTING.md). M0 is complete, so both M2 prerequisites are available.

**Outcome:** a small, idiomatic Nuxt application whose meaningful changes can be checked consistently.

**Deliverables:** pinned tool/runtime versions, package lockfile, TypeScript configuration, basic app shell, Vitest/Nuxt test setup, Playwright setup, formatter/linter, GitHub Actions checks, contributor setup documentation, and the canonical `pnpm verify` command.

**Scope:**

- Confirm compatible current Nuxt/testing versions when implementing; justify added packages and avoid installing speculative player/CMS dependencies.
- Establish domain/server/client boundaries and the minimal HTMLAudioElement adapter test seam.
- Make the canonical command run formatting, lint, types, meaningful unit/integration tests and coverage, production build, and deterministic browser smoke tests. Extend its coverage as features arrive.
- Use a small local audio fixture with clear reuse rights for real browser smoke tests; controlled media events cover timing-dependent behavior.
- Configure pull-request checks with no deployment secrets exposed to untrusted contribution jobs. Publication/deployment work belongs in M5.

**Acceptance/verification:** a fresh checkout can install with the locked dependency graph and pass the documented canonical command; CI runs the same entry point; a test exercises actual behavior rather than importing configuration merely for coverage. Initial SSR and client hydration succeed without accessing browser media/storage on the server.

### M2 - Canonical content and complete archive

**Completed locally on 2026-09-08:** [M02-canonical-content.md](docs/milestones/M02-canonical-content.md#completion-evidence---2026-09-08). The canonical archive contains all 55 episodes, 832 tracks, 338 starts across 22 episodes, 156 assets, and 55 legacy mappings. JSON authoring, create-only imports, historical identity protections, and shared public content APIs are implemented. Praxis uses its verified duration and precise splits; one legacy track apostrophe is corrected with provenance, while the original M0 inputs remain unchanged. `pnpm verify` passed with 111 application/content tests, 12 migration tests, 25 browser checks, and coverage above the existing thresholds. Fresh installation/build and portable server-asset loading passed. M3 and M4 can consume the same public repository; no feed or player UI is claimed complete.

**Outcome:** the frontend and feed can consume the same complete, validated archive.

**Deliverables:** episode/show schemas, normalized domain model, canonical content files, repeatable import tooling, content validation, public-content access layer, asset manifest, and initial authoring instructions.

**Scope:**

- Select the authoring format from representative imported episodes, including long descriptions and partial/untimed tracks.
- Normalize timestamps to numeric seconds without discarding display metadata. Preserve original ordering for display; validate known start times as finite, nonnegative, and ordered, with a policy for duplicate starts and duration bounds.
- Keep the original GUID/permalink semantics, publication instant, enclosure metadata, and artwork associations. Distinguish absent optional information from invalid supplied information.
- Import deterministically and emit a reconciliation report; rerunning must not create duplicates or overwrite subsequent hand edits without an explicit reconciliation mode.
- Return the same published episode set and deterministic order to page/list/feed consumers. Archived source drafts remain excluded even before M9 adds new authoring workflows.
- Store media references and checked byte lengths, not MP3 blobs in Git. Record assets independently so media copies can be verified without re-encoding them.

**Acceptance/verification:** normalized published count and identities match M0; no unexplained discarded episodes, tracks, or descriptions; all artwork/audio references reconcile. Tests cover malformed content, duplicates, date/timezone handling, ordering ties, empty/untimed lists, escaping/sanitization, and public-content filtering. Import rerun evidence proves reproducibility. Run the canonical verification command.

### M3 - Replacement podcast RSS

**Completed and merged on 2026-09-08:** [M03-podcast-rss.md](docs/milestones/M03-podcast-rss.md#completion-evidence). PR [#2](https://github.com/treyturner/nurevolution.net/pull/2) was rebased and merged to `main` at `fc0f261`; [main CI passed](https://github.com/treyturner/nurevolution.net/actions/runs/34289605132). The complete 55-item RSS, verified show settings, both legacy aliases, GET/HEAD/304 behavior, stable weak ETags, and independent offline feed gate are implemented. A fresh merged-main `CI=1 pnpm verify` passed with 187 application tests, 12 migration tests, and 37 browser checks; coverage exceeds all existing thresholds. Historical episode/media identities and frozen source/report hashes remain unchanged. Public validator/client and media-delivery acceptance remain M5/M6 work; M4 can use the feed and must supply historical page redirects.

**Outcome:** produce the complete compatible podcast feed without WordPress or podPress at runtime.

**Deliverables:** independently testable RSS serializer, Nitro `/feed/podcast` route, public metadata compatibility assertions, route/header tests, and a feed validation checklist.

**Scope:**

- Generate RSS from M2's model, with correct namespaces, required show metadata, publication dates, item identity, enclosure URL/type/actual byte length, and properly escaped text.
- Preserve known episode GUIDs exactly, including permalink semantics. Retain existing enclosure URLs where the chosen infrastructure supports them; review unavoidable changes against M0 and test old paths.
- Return XML at the existing feed path, account for trailing-slash/legacy feed aliases discovered in M0, and avoid accidental HTML error pages or browser challenges.
- Define feed cache freshness and validators without deriving “last changed” from an arbitrary request clock. Keep this compatible with future scheduled visibility in M9.
- Omit optional episode artwork/chapters until M8 unless explicitly promoted; retain show artwork and any already-required feed fields.

**Acceptance/verification:** parse generated XML with an independent parser and assert semantic fields against the full canonical inventory and legacy fixtures. Cover XML metacharacters, dates, URL encoding, absent optional fields, duplicate GUIDs/enclosures, content type, and route behavior. A complete feed requires more than one successful sample item. Apple documents immutable GUIDs, enclosure URL/length/type, and HEAD/range-capable media delivery; use its current requirements when writing the validation checklist. [Apple podcast RSS requirements](https://podcasters.apple.com/support/823-podcast-requirements)

Run `pnpm verify`. External validator/client results are provisional until repeated against the public M5/M6 deployment; never report automated XML tests as directory acceptance.

### M4 - Initial archive player and responsive dark design

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

### M5 - Production delivery and operational rehearsal

**Implemented and rehearsed; production active:** [M05-production-delivery.md](docs/milestones/M05-production-delivery.md) records verified delivery, capacity, rollback, MinIO application/archive restore, and independent Headscale recovery. Subsequent [M6 closure](docs/milestones/evidence/M06-retirement.json) records legacy retirement, accepted client/device limitations, verified Unraid boot persistence, and the accepted four-hour recovery objective. Replacement-host recovery measurement and cost/storage/transfer review continue as routine operations. Historical rehearsal and cutover release identities remain in their evidence records.

**Outcome:** a deployable, recoverable release on the chosen infrastructure, with media and HTTPS working independently of the home WordPress stack.

**Deliverables:** documented D04/D08 decisions and cost estimate; container/reverse-proxy configuration; media upload/verification process; GitHub Actions image publication and deployment workflow; preview environment; backup/restore, certificate, deployment, rollback, and incident runbooks.

**Scope:**

- Validate the selected 1 GB droplet's capacity for nurevolution and host services. Assess additional sites when they are added. Build in CI, measure startup/runtime/maintenance peaks, reserve host headroom, and default to one app instance with a tested stop/start rollback procedure. Permit overlapping instances only if measured capacity supports them.
- Keep nurevolution configuration, resources, application networks, secrets, and release state separate so other sites can be added later. Its deploy must preserve unrelated routes and containers. Planning or provisioning those future sites is outside M5.
- Configure persistent droplet media storage, its hostname, and legacy enclosure routing. Copy assets with checksums; test correct types/lengths, HEAD, range responses, resume, and download headers for every mapped object. Serve original enclosure paths unchanged where possible; otherwise record and test the shortest compatible redirect to the unproxied media host, preserving GUIDs.
- Move certificate issuance/renewal for this site off pfSense. Persist ACME state; rehearse challenge issuance with a test environment and verify production renewal configuration and restart persistence.
- Define Cloudflare DNS/proxy/cache/security rules for the website and the selected media topology. Ensure feed/media clients can fetch without interactive challenges; avoid stale HTML/feed responses hiding releases.
- GitHub Actions must verify before publishing; deploy the tested image by immutable digest. Define the owner-selected release trigger, health checks, failure handling, and return to the previous image/configuration.
- Keep deployment credentials in appropriate secrets stores and production changes out of untrusted PR workflows. Document content/asset backups separately from recreatable app images.
- Record basic operational checks for availability, feed failures, storage/transfer usage, and certificate expiry; listener analytics remain outside scope.

**Acceptance/verification:** rehearse an actual deployment and application rollback in the preview environment; restore required persistent state from a backup; validate all media mappings and a representative full transfer; demonstrate working HTTPS after a restart; validate the feed externally and in a real podcast client. Record tested image digest, configuration version, media manifest, costs, and unresolved issues. Run canonical verification for code/config changes plus the documented environment checks.

### M6 - Cutover and WordPress retirement

**Closed on 2026-09-18:** [M06-cutover-and-retirement.md](docs/milestones/M06-cutover-and-retirement.md). The owner confirmed that the old site and database are retired and their backups are confirmed, accepted the observation outcome and a four-hour recovery target, and requested closure. Podcast Addict load/seek coverage and Unraid persistence checks passed. The [closure evidence](docs/milestones/evidence/M06-retirement.json) records remaining limitations and follow-ups; it does not claim an unmeasured replacement-host recovery time or unperformed client tests.

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

### M7 - Rich player, interactive tracklists, and restoration

**Implemented and released.** The [M7 record](docs/milestones/M07-rich-player-and-restoration.md) documents the player, restoration, seeking/volume, track navigation, and episode sequencing implementation and subsequent UI refinements. The owner authorized production release on 2026-09-14, superseding the initial deployment prohibition. M6 is now closed. Safari 14.3 compatibility and current physical-Safari testing are separate follow-ups; assistive checks are owner-deferred enhancements.

**Outcome:** deliver the full application-like listening experience using the established player/model boundaries.

**Deliverables:** custom controls, interactive timed tracks, automatic highlighting, episode sequencing/list sort, and local 24-hour restoration. Implement as separately reviewable slices: restoration; seeking/volume; track navigation; episode sequencing.

**Scope:**

- Apply the confirmed D01/D02 decisions and turn section 3 into explicit transition tables before implementation. Separate user intent, browser media events, and route changes to avoid races.
- Add previous/next episode, previous/next track, ±30 seconds, play/pause, seek/progress, volume, and mute controls with accessible labels and state.
- Implement the exact three-second previous-track rule; handle missing/untimed tracks and boundaries without inventing timestamps.
- Implement the shared list-sort/navigation semantics and episode wraparound, including a one-episode archive. Only already-active playback may continue automatically.
- Restore current episode/position within the 24-hour visit window, always paused. Resolve explicit route precedence, expiry boundary, position beyond changed duration, removed episodes, storage failure/corruption, and tab behavior.
- Seek after metadata is available; ignore stale responses/events after episode changes. Do not let a delayed play promise restart audio after a later pause.

**Acceptance/verification:** unit tests cover navigation tables, exactly/just before/just after three seconds, oldest/newest wrap, single/empty eligible collection, clamping, and timestamp gaps. Use a fake clock for the 24-hour boundary and fake media events for loading/error/race behavior. Browser tests cover paused versus active episode/track clicks, refresh restoration without play, route history, keyboard sliders, and unsupported volume behavior. Run `pnpm verify` and real-device media checks.

### M8 - Listening and feed enhancements

**Implementation consolidated in PR #56.** The owner prioritized this milestone ahead of drafts/scheduling on 2026-09-18 and deferred palettes and track/artist/release links. See the [M8 implementation plan](docs/milestones/M08-listening-and-feed-enhancements.md) for contracts, evidence, exclusions, and commit boundaries. All five areas and subsequent UI refinements are included in the expanded PR at the owner's request. The earlier Safari-only head passed CI/automatic review and partial actual-iPad acceptance; the expanded PR passed its full local gate and awaits fresh remote CI/review; remaining device/client acceptance is still required. No M8 changes are deployed.

**Outcome:** share precise listening positions, use supported device media controls, expose existing artwork/timed tracks in the feed, and restore ordinary playback on Safari 14.3.

**Required scope:**

1. Safari 14.3-compatible startup and playback, useful initialization-failure feedback, and acceptance on the owner's iPad.
2. Timestamp share links for the current position and timed track starts; explicit positions override remembered state and open paused.
3. Media Session metadata and supported lock-screen/headset actions, using existing player/track rules with graceful unsupported-browser behavior.
4. Per-episode feed artwork from verified sources, preserving original assets and subscriber identities.
5. Podcasting 2.0 JSON chapters from canonical timed tracks, with public endpoints, correct cache validators, and Podcast Addict acceptance.

**Acceptance/verification:** preserve canonical fractional seconds and [truncate earlier when lower precision is required](docs/CONTENT.md#episode-fields-and-new-episodes). Cover URL/restoration precedence, no autoplay, player races, unsupported device APIs, untimed/missing tracks, feed compatibility, and unpublished endpoint filtering. Run `pnpm verify`, actual Safari 14.3 playback/seek checks, supported device controls, and a chapter-capable podcast-client check. Existing missing metadata does not block chapter generation for timed episodes.

**Delivery:** Safari, sharing, device controls, feed support, and RSS advertisement retain distinct commit boundaries within the consolidated PR. All five areas are required to close M8. The resource-support release must still be published, deployed, verified, and retained as a fallback before the RSS-advertisement release. No M8 deployment is authorized.

### M9 - Drafts and scheduled repository publishing

**Outcome:** the owner can prepare an episode, validate it, and publish now or at a specified time without editing independent website/feed copies.

**Deliverables:** authoring template/instructions, draft/publish metadata, scheduled visibility logic, publication validation, cache policy, content-preserving rollback, and a tested publication workflow.

**Scope:**

- Define explicit publication intent and a timestamp with timezone. Keep historical publication dates stable; invalid authoring input fails with actionable feedback.
- Drafts never appear on the public site/feed; future eligible episodes appear when due. Use one server-side publication predicate for lists, direct pages, RSS, sitemap if present, next/previous controls, and data endpoints.
- Do not ship drafts/future episode data through client bundles, Nuxt hydration payloads, or public collection endpoints. Scheduled content must be deployed ahead of time for the server to make it visible.
- Prefer server-time evaluation and bounded cache freshness over requiring a precisely timed GitHub Actions run. Resolve D09 and prove the transition occurs without a new deploy.
- Coordinate static delivery/download maps and all public media paths with publication state. Replace the current future-date deployment rejection only when application and delivery visibility stay aligned.
- Resolve the current requirement for matching subscriber identities across candidate/fallback releases. Publishing a new episode needs a fallback that preserves already-public GUIDs and enclosures; do not bypass the rollback guard.
- Document asset upload/readiness before publication, validation, failed deploy handling, timezones, and correction of already-published metadata without changing GUIDs.
- Because the repository is public, committed draft source is publicly readable there. Draft means unpublished on the website/feed, not confidential; do not promise private previews or private media storage.

**Acceptance/verification:** fake-clock tests cover before/at/after publication time, timezone equivalence, drafts, invalid schedules, ordering changes, and feed/cache validators. Deployed tests confirm visibility within the agreed tolerance without a rebuild, no future/draft metadata in any public app response, and correct behavior after restart/rollback. Run `pnpm verify`; the owner can follow the instructions to prepare and schedule a test episode.

### Deferred work beyond the committed milestones

| Item                                          | Dependency / boundary                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Additional dark palettes and brand refinement | Explicitly deferred by the owner; retain accessible contrast/focus and dark-only styling when separately scoped.                                 |
| Optional track/artist/release links           | Explicitly deferred by the owner; later design must validate safe links and preserve track-seek interaction.                                     |
| Unlisted publicly reachable previews          | Depends on M9; separately decide value/scope, exclude from ordinary listings/feed/indexing, and distinguish unlisted from draft/private content. |
| Evaluate DigitalOcean Spaces                  | Operational usage/cost review; migrate only if justified, preserving checksums, ranges/downloads, legacy enclosures, GUIDs, and rollback.        |
| Independent browsing during playback          | Separate product/state-model decision; current episode-change confirmation remains in place.                                                     |

Directory submissions and missing-content research remain separate owner/editorial work. They are not automatic effects of feed modernization or M8 completion.

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
