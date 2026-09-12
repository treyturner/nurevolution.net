# M6 — Cutover and WordPress retirement

Status: **Cutover preparation in progress, 2026-09-12.** The owner authorized continuing cutover and confirmed the existing WordPress runtime and all fallback files can remain intact. Public routing and WordPress remain unchanged; the production GitHub environment exists with both deployment gates disabled. The owner confirmed on 2026-09-12 that WordPress has not changed since the audit and can stay frozen. The owner chose to proceed with the current player and defer M7 until after cutover; the remaining acceptance items below gate live cutover, not preparation of this plan.

Roadmap: [M6](../../ROADMAP.md#m6--cutover-and-wordpress-retirement). Dependencies: [M5 rehearsal](M05-production-delivery.md), [deployment operations](../DEPLOYMENT.md), [feed validation](../FEED-VALIDATION.md), and [rollback](../operations/rollback.md).

## Outcome and boundaries

Serve the replacement at the existing production domains, preserve subscribers' episode identities and media access, and retire the running WordPress services after an agreed observation period. Keep recoverable historical backups.

| Requirement  | M6 acceptance                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-FEED      | Complete RSS at the existing canonical URL; historical GUIDs, enclosure identities, dates, and legacy feed aliases remain correct; external validation and existing-client observations recorded. |
| R1-PLAYER    | All reconciled episodes load directly and through the archive; correct artwork, duration, playback, seeking, and paused entry; public media checks reach the new origin.                          |
| R1-TRACKS    | All reconciled static tracklists appear, preserving untimed entries.                                                                                                                              |
| R1-DOWNLOAD  | Every episode maps to the correct attachment; full representative downloads/resume preserve filename, length, and hash.                                                                           |
| R1-SUBSCRIBE | Header subscription link and discovery metadata reach the canonical production RSS; existing subscriptions refresh without duplicate or missing episodes.                                         |
| Operations   | A recorded cutover, tested fallback, current independent backup, owner/operator handoff, and retirement record.                                                                                   |

The current player satisfies the intended R1 feature scope. The owner confirmed on 2026-09-12 that M7's custom controls, interactive tracklists, sequencing, and 24-hour restoration will follow cutover. M8 publishing, Spaces, new directory listings, analytics, and other sites are outside M6. Preserve compatibility with future sites and existing unrelated services.

## Entry evidence and repository map

- Clean `main` at `daa7e7b93a210c76e022622c88f6fb8428639bd1` when planning began. PRs #13 and #14 are merged; no open PRs were returned by GitHub. [Main Verify/publication 34685197866](https://github.com/treyturner/nurevolution.net/actions/runs/34685197866) and [preview deployment 34685541203](https://github.com/treyturner/nurevolution.net/actions/runs/34685541203) succeeded for that exact commit. Preview's public health endpoint was rechecked during planning and reported the same healthy release. Refresh this selection if implementation changes main.
- Canonical baseline: 55 episodes, 832 tracks, 338 known starts across 22 episodes, and 156 media assets. The 55 small artwork derivatives total 111,474 bytes; deployed thumbnail bytes and canonical clipboard links were checked after the latest deployment. Final counts must follow any explained legacy delta rather than conceal it.
- [M5 live evidence](evidence/M05-live-rehearsal.json) binds the earlier rehearsal release to all-asset delivery, three desktop browser engines, capacity under backup load, about one second of sampled application interruption, rollback, and isolated application/certificate recovery. These observations are historical evidence, not fresh measurements of every subsequent release.
- [Headscale recovery evidence](evidence/M05-headscale-backup-live.json) records a healthy isolated restore, preserved server keys/node, weekly schedule, and verified retention reports. PR #8 closed the recorded helper-review/report-output work. Owner-managed Unraid reboot verification remains open.
- `content/`, `docs/migration/`, `tools/migration/audit.py`, and `tools/content/check-feed.ts` supply the canonical archive and frozen comparison evidence. Never regenerate M0 references to explain away a difference.
- `tools/deploy/host.ts`, `deploy.ts`, `render-config.ts`, and `cli.ts` implement the existing release transaction, profile, media checks, and environment-scoped history. `.github/workflows/deploy.yml` promotes a verified main artifact; it does not build a new image. `deploy/nurevolution-deploy` checks the production marker before invoking it.
- `test/unit/deployment/`, `test/delivery/run.ts`, `test/e2e/feed.spec.ts`, `content.spec.ts`, and `downloads.spec.ts` are the existing regression boundaries. Use them for demonstrated gaps; do not add a second deployment system.

## Decisions and outstanding evidence

| Item                       | Current position                                                                                                                                                                                                                                                      | Needed before                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Release sequencing         | Owner chose on 2026-09-12 to proceed with cutover using the current player; M7 follows launch.                                                                                                                                                                        | Candidate freeze and launch approval.                                                |
| Legacy content             | Owner confirmed on 2026-09-12: no WordPress changes since the audit; it can stay frozen. Retain a final feed comparison and verified rollback capture before cutover.                                                                                                 | Final delta signoff.                                                                 |
| Routing                    | Confirmed website through Cloudflare, media DNS-only, Full (strict), existing canonical names. Include A/AAAA/CNAME/proxy/cache rules and the owner's local DNS overrides.                                                                                            | Cutover runbook and traffic switch.                                                  |
| Host capacity              | Owner-selected $8 Premium Intel, 1 vCPU/1 GB/35 GB/1 TB, NYC1, Ubuntu 26.04 LTS. Loaded M5 rehearsal passed; refresh disk, memory, backup status, and current transfer usage.                                                                                         | Candidate promotion.                                                                 |
| Budget and recovery        | Weekly/after-change backups, four weekly and three monthly retained, are confirmed. Total extras/traffic budget and the proposed four-hour whole-host recovery target remain unaccepted. Existing-host restore is demonstrated; replacement-host provisioning is not. | Operational signoff; record the accepted target and any remaining limitation.        |
| Manual acceptance          | Owner accepted mobile testing as sufficiently complete for launch on 2026-09-12 after Brave/Android feedback and corrections. Additional iPhone/screen-reader checks are not claimed as performed; actual subscription refresh remains a post-switch check.           | Launch readiness, followed by canonical-host client refresh after switching traffic. |
| Headscale boot persistence | Saved early firewall call and Compose restart policy confirmed; no completed reboot observation recorded.                                                                                                                                                             | Record result or an explicit owner-accepted deferral in the operational handoff.     |
| Operator and observation   | Proposed: owner is accountable for release/fallback decisions, agent executes authorized accessible operations, owner executes Unraid/pfSense/device steps. Proposed observation: seven days, with checks immediately, after 24 hours, and at the end.                | Approval of the concrete cutover record.                                             |

The owner explicitly authorized continuing cutover on 2026-09-12. Continue the preparation within that authorization and report the exact candidate, fallback, test results, remaining limitations, and operator actions before switching traffic. Retirement follows the agreed observation period; it has not occurred. Unanswered items stay marked pending; no new account purchases or new notification messages are assumed.

## Implementation slices

### 1. Freeze and reconcile the final archive

Deliver `docs/milestones/evidence/M06-migration-delta.json` and the private rollback capture.

A [fresh live feed comparison](evidence/M06-feed-comparison.json) on 2026-09-12 confirms that the legacy feed is byte-identical to M0/M3 and preview is byte-identical to the documented M3 replacement. All 55 ordered subscriber identities/enclosures/publication instants/item links are preserved. Full-description visible text is retained; the named presentation, duration-format/Praxis, explicit-spelling, and cache-guidance differences remain accounted for. The [read-only source recheck](evidence/M06-migration-delta.json) also matches the original M0 WordPress tree, all audio/uploads, and SQL dump byte hashes. The actual verified source paths are WordPress under `/home/coder/dev/net.nurevolution/wp`, SQL `/home/coder/dev/net.nurevolution.db/nurevolution.sql`, and the supplied podcast/uploads roots. The owner retains the unchanged legacy runtime for fallback. Actual podcast-client acceptance remains pending.

1. Record the owner's 2026-09-12 confirmation that WordPress is unchanged and can remain frozen, together with source snapshot identities. Preserve the supplied WordPress tree, SQL export, and audio sources as read-only inputs. No new content import is expected. If the owner resumes editing or final checks reveal changes, obtain a fresh consistent snapshot into separate private locations and reconcile it before cutover.
2. Capture the live legacy feed and response metadata separately using `tools/migration/audit.py capture-feed`; retain the original M0 snapshot. Compare final feed identities, publication instants, enclosures, titles/descriptions, show data, media hashes, and known legacy paths against both the frozen audit and canonical content. An unchanged public feed does not prove unpublished/private database state is unchanged.
3. Record every difference as an intentional replacement presentation change, an already documented correction (including Praxis), a new legacy change to import, or an unresolved discrepancy. Reconcile new changes explicitly in `content/` and derivative assets. Preserve protected historical identities and do not rerun the create-only importer over authored content.
4. Recheck the actual legacy web/database container names, persistent paths, routing, certificate dependencies, and restart configuration. Save a consistent SQL dump, uploads/code/media references, Compose/runtime configuration, and DNS/HAProxy configuration needed to restore service. Store sensitive material privately with independent recovery copies; public evidence contains hashes and descriptions only.

If the archive changed, the release transaction's matching-subscriber-identity protection also applies. Prepare a content-compatible fallback and focused tests before publishing a new candidate; do not bypass that protection to force a deployment.

### 2. Finish launch acceptance on preview

Deliver `docs/milestones/evidence/M06-acceptance.json` with distinct pre-cutover and post-cutover observations.

1. Select one exact verified main commit/run/image pair, deploy it through the existing preview workflow, and record its health identity. Reuse the current pair only if no intervening code/content changes invalidate it.
2. Repeat the archive/media and feed checks relevant to that final candidate using existing tooling. Record the actual destination: preview browser media uses preview origins, while RSS preserves canonical enclosures. A podcast client reaching old production audio is not evidence of candidate audio delivery.
3. Obtain physical-device observations against preview: initial page stays paused and shows duration, play/seek/pause, paused and playing episode changes, back/forward navigation, tab layout, artwork modal dismissal/focus, download/save behavior, and clipboard feedback. Record any device limitations rather than treating desktop WebKit as iPhone evidence.
4. Record screen-reader/keyboard checks for the episode list, selected status, player controls, modal focus/escape, copy status, and RSS link. Retain the existing enlarged-text/reflow checks. Repair demonstrated blocking issues with focused regressions.
5. Record current backup completion/check status, Discord failure wiring evidence, available memory/disk, and DO transfer/account costs. Confirm password/key recovery locations without exposing values. Obtain the remaining operations decisions in the table above.

### Pre-cutover link and feed-access audit — 2026-09-12

The owner requested environment-local RSS navigation before cutover. The header link and browser RSS discovery now use `/feed/podcast` in the local working tree; this change still needs release publication/deployment. Episode/home navigation and thumbnails use local paths. Browser artwork/audio and deployed download redirects use the accepted environment profile. A live preview Download HEAD check returned 307 to `https://podcast-preview.nurevolution.net/downloads/trey-turner-praxis`.

The local RSS-link change passed `CI=1 NUREVOLUTION_DOCKER_ADDRESS=172.18.0.2 pnpm verify`: 338 application/tooling tests, 121 browser checks with the two existing skips, and the Docker delivery gate. Coverage was 98.2% statements, 96.13% branches, 98.19% functions, and 98.53% lines. The click regression verifies the preview response with production requests blocked; Firefox downloads the same RSS bytes, while Chromium/WebKit display the document. Dev-server SSR was checked for both relative RSS links.

Canonical page metadata and copied episode URLs retain production URLs. RSS XML also retains production self/website/artwork/item/enclosure URLs and historical GUIDs; opening preview RSS does not make a podcast client use preview media. Raw content APIs preserve these canonical records. The local Node download fallback fetches production audio server-side; deployed downloads use Caddy's environment-specific route. The archive's two description links go to Beeple and Spotify, with no additional production-site navigation found there.

**Resolved preview feed-access issue:** the public preview feed initially returned HTTP 200 to curl's default user agent, but HTTP 403 with body `error code: 1010` to `Python-urllib/3.14`. The same Python user agent received HTTP 200 when the HTTPS request was resolved directly to the droplet with hostname/TLS verification preserved. This isolates the observed denial to the Cloudflare path. Cloudflare documents [error 1010](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/) as a browser-signature denial and supports a [selective Browser Integrity Check exception](https://developers.cloudflare.com/waf/tools/browser-integrity-check/). The owner deployed a Configuration Rule disabling Browser Integrity Check only for GET/HEAD on the feed and its aliases on canonical/www/preview hosts. [Subsequent public probes](evidence/M06-feed-access.json) returned 200 for the unchanged 55-item feed and 301 for both aliases with the previously blocked user agent; the homepage control remains 403. Repeat on canonical hosts after cutover. The DNS token cannot independently read the saved rule; its deployed scope is owner-confirmed and behavior is observed.

### Mobile and host preparation — 2026-09-12

The owner reports Brave 1.94.121 / Chromium 152.0.7977.83 on Android 16 (BP4A.251205.006). Android success feedback now uses a three-second inline checkmark on the clicked permalink button, preserving the accessible status and visible copy failures. This avoids duplicating Android's clipboard popup without guessing the OS version from its reduced user-agent string. The focused six-test clipboard suite passed; deployed phone acceptance remains pending.

The owner also observed a multiple-download permission prompt on preview, which did not recur after reopening the site, possibly because permission was saved. Both download controls are ordinary anchors; preview has one 307 to the media host and the development fallback returns the attachment directly. Chromium and Firefox probes each observed one download event per click. These observations do not establish the cause of Brave's native prompt. The regression suite now checks both controls for one saved file per click using small fixtures; physical-device confirmation remains distinct.

The live `www.nurevolution.net` alias currently redirects to the apex. The renderer now preserves that redirect, including the request path/query; the bootstrap TLS configuration explicitly includes its hostname. The [live host preparation record](evidence/M06-host-preparation.json) records the appended certificate policy, graceful reload, trusted Let’s Encrypt handshake for `www`, and successful backups before and after issuance. Existing HTTP routes were preserved; the new redirect awaits candidate deployment.

The owner created GitHub's `production` environment after the integration returned 403 on creation. Connection variables and the pinned SSH secrets are installed; `DEPLOYMENT_ENABLED` and `CUTOVER_ENABLED` remain false. The deployment runner's enrollment secret is pending owner entry. The DNS token cannot change Cloudflare settings; the owner deployed the narrowly scoped feed exception and its behavior passed. Current private DNS/host captures are retained outside Git. The host inspection found a healthy preview, no deployment locks, about 426 MiB available memory, and about 16 GiB free disk. Two September 12 backups and repository checks subsequently passed, including the new certificate state. Refresh capacity before promotion.

The combined RSS, Android feedback, download regression, and `www` changes passed the full gate: 340 application/tooling tests, 121 browser checks (two existing skips), and Docker delivery including all five certificate hostnames, path/query-preserving `www` redirects, and saved downloads through all three browser engines. Coverage is 98.21% statements, 96.17% branches, 98.19% functions, and 98.54% lines. These were the local results before the preview promotions and owner acceptance recorded below.

### Preview candidate and touch-volume follow-up — 2026-09-12

[PR #15](https://github.com/treyturner/nurevolution.net/pull/15) was squash-merged after green CI and two completed reviews without findings. Main `3da6c0b92d89b9335f5f947068563bc32ce2ad8f` passed [Verify/publication 34711080850](https://github.com/treyturner/nurevolution.net/actions/runs/34711080850) and [preview deployment 34711493329](https://github.com/treyturner/nurevolution.net/actions/runs/34711493329). Matching verified host tooling was installed before promotion. Public health reports that exact commit; the direct-origin `www` redirect preserves encoded path/query values with trusted TLS. A Chromium touch/Android-user-agent check confirmed canonical clipboard contents, inline feedback without a floating success toast, three-second clearing, and navigation to the complete preview feed. This does not substitute for physical Brave acceptance. The external feed validator passes with only the expected preview self-URL recommendation; the unchanged 156-asset manifest passed the live HEAD/range/download-mapping audit before this promotion.

The owner then reported empty space beside Android’s native mute button. The desktop CSS forced a 100-pixel volume container even when Chromium’s platform preference hid the slider. Restricting expansion to `(hover: hover) and (pointer: fine)` restores compact touch controls. A local Chromium check using `preferHiddenVolumeControls=true` and a 393-pixel touch viewport measured the container shrinking from 100 to 32 pixels and the seek bar growing from 138 to 206 pixels. Desktop retains its 100-pixel container and visible 52-pixel slider. [PR #16](https://github.com/treyturner/nurevolution.net/pull/16) was subsequently accepted and squash-merged as `a1bd8c497fefb034c1fb502d497622f5e85586ca`; [main Verify/publication 34712171664](https://github.com/treyturner/nurevolution.net/actions/runs/34712171664) and [preview deployment 34712566493](https://github.com/treyturner/nurevolution.net/actions/runs/34712566493) passed. Live touch/desktop measurements matched the local result, and post-deployment backup `851940771f79c4ba7157255ff3e303955d0a06f8663b1ea3d7b4fa857aabf0b4` passed its repository check. Native device-volume behavior remains platform-dependent; custom controls remain M7.

### Final header review and mobile acceptance — 2026-09-12

The owner approved the local header revisions for PR review and merge, then explicitly requested continuing cutover: mobile testing is sufficiently complete for this release. The header uses the supplied temporary logo at the left of the title/subtitle and as its favicon, plus a recolored square RSS symbol with tighter inner padding and optical centering. Branding is plain text/image: clicking it no longer selects the latest episode. The original 300-pixel PNG is served locally and unchanged; its SHA-256 is `c83a5726124a11e55d1e66282673374e79bc9ca9e2a2b89c86fd97ade87fe84d`.

The complete header revision passed `pnpm verify`: 340 application/tooling tests, 121 browser checks (two existing skips), and Docker delivery. Direct dev checks also confirmed favicon/image delivery, unchanged episode selection when branding is clicked, and narrow/enlarged-text reflow. The existing modal-focus test now targets the still-interactive RSS link. Additional physical-device testing is not a cutover blocker under the owner's acceptance; this does not mark unperformed iPhone/screen-reader or post-switch subscription checks as passed. Select the new successful main release after PR acceptance rather than deploying the local working tree.

### 3. Prepare and rehearse the one-slot transition

The [operator cutover runbook](../operations/cutover.md) records the concrete host/DNS/profile/fallback sequence. Deliver a reviewed production profile based on measured settings, and `docs/milestones/evidence/M06-transition-rehearsal.json`.

The existing host has one app/network-alias/edge-route slot. Preview and production have separate deployment records and Compose project names. Starting production does not automatically stop the preview project. The first production release has no `state/production/previous.json`; preview is not a valid automatic production fallback.

The operator runbook must make these steps concrete before touching the live host:

1. Inventory and save the accepted preview profile, Compose/environment inputs, exact bundle/tool hashes, state, edge route, DNS, and local resolver settings. Record names and checksums, with private values outside Git. Recheck that no deployment, backup, or unresolved journal is active. Coordinate every edge edit through the existing site/edge locks.
2. Disable preview workflow promotion and verify no preview job is queued/running. Preserve production's disabled gates while preparing the exact production environment settings, pinned SSH identity, secrets, and accepted profile. Carry forward measured resource values, not larger example defaults.
3. Prepare a bounded way for the droplet's own HTTPS acceptance to resolve only the canonical site/media names to the candidate while public DNS still serves WordPress. `host.ts` uses ordinary HTTPS requests to profile origins, so external `curl --resolve` checks alone do not solve this. Proposed operator method: a backed-up, identifiable temporary hosts-file block on the droplet, with exact restoration and verification on success/failure. Preserve hostname/SNI and trusted TLS. Prove it works for the actual Node process; do not use insecure TLS or change public DNS solely to get a deployment green.
4. With the owner-approved transition record, stop/remove only the recorded preview app, preserving its state, bundle, media, edge, and unrelated services. Reconcile only Nurevolution's route/profile for the production project. Enable the production gates and run the normal verified production promotion. Keep WordPress serving public traffic while canonical-host acceptance targets the candidate.
5. On first-promotion failure, inspect the transaction journal. Public traffic still uses WordPress; do not invoke a nonexistent production previous-release rollback. Restore the saved preview app/profile/route only through explicit environment reconciliation after resolving any journal and production marker/state, preserving failed-attempt evidence. Verify its exact prior identity before reopening preview promotion.
6. On success, retain preview history offline, keep preview promotion disabled, and verify candidate canonical pages/feed/media through a controlled external resolver as well as from the droplet. Remove the temporary resolver block after public DNS is switched and public acceptance passes; record restoration on every exit path.

Exercise the procedure with disposable projects, synthetic media, and the existing delivery fixture: preview-to-production success; occupied preview alias; interrupted transition; candidate acceptance failure with no production predecessor; restoration of preview; and attempted preview promotion after production is accepted. Assert media/shared-edge/sentinel continuity and correct environment history. Put necessary regression coverage in `test/unit/deployment/host.test.ts` and `test/delivery/run.ts`; change host/tooling only for a demonstrated missing guarantee. Any changed executable requires the matching verified installed host tooling before promotion.

### 4. Switch traffic and validate canonical delivery

Deliver `docs/milestones/evidence/M06-cutover.json` containing the chosen release, operator, timestamps, sanitized before/after routing, checks, and rollback decision.

1. Present the final R1 matrix and remaining R2/R3 work for the owner's launch decision. Confirm the freeze, observation period, operator availability, fallback configuration, backups, and accepted limitations. The runbook names who executes each inaccessible Cloudflare/pfSense/Unraid step.
2. Capture authoritative records and existing TTLs before changing them. Allow for their observed cache lifetime. Switch the website to the droplet through Cloudflare and media to the droplet with DNS-only routing. Reconcile stale AAAA/CNAME records and the owner's local DNS overrides explicitly; do not edit unrelated records or relax Full (strict).
3. Fetch the canonical site/feed/media from outside the origin/home network and from the owner's LAN using normal resolution. Confirm the served release, TLS hostnames, redirects, canonical metadata, absence of preview indexing headers on production, cache/ETag behavior, and no local-network permission dependency. Recheck through Cloudflare, not only directly at the origin.
4. Run the all-asset HTTP audit and all 55 canonical/legacy page/download mappings (or the explained final count), plus representative full/resumed transfers. Run the external validator at the unchanged canonical RSS URL.
5. Refresh an existing subscription in Apple Podcasts where available and at least one other client. Record versions, time, archive endpoints, duplicates/missing items, artwork/descriptions, streaming and downloads. Do not submit a new show or preview feed. If an account/device is unavailable, record the exact pending check and owner decision.
6. Verify a new encrypted site backup after the accepted production state. Record selected snapshot and successful check. Preserve the legacy freeze during the observation period unless a separately reconciled publication/fallback is approved.

### 5. Observe and retire WordPress

Deliver `docs/milestones/evidence/M06-retirement.json`; update this plan, the roadmap, README, deployment/feed guides, and operational handoff.

- Proposed immediate rollback triggers: lost/changed subscriber identity, missing episodes/media, persistent TLS/feed failure, repeated playback/download failure attributable to candidate delivery, or exhausted host resources. Define measurable duration/thresholds and the responsible operator in the runbook before launch. A cosmetic issue alone does not require DNS rollback.
- During the agreed observation period, check health/feed/media, error/restart/OOM state, available disk, transfer usage, certificates, and scheduled backups. Record public and owner observations. Leave WordPress recoverable at its original origin while cached old DNS can still reach it.
- If rollback is necessary, restore the saved public and local routing to WordPress and verify feed/media externally. DNS rollback is not instantaneous. Keep candidate media reachable during propagation. After any later publication, reconcile newly public identities/content into the legacy fallback before considering it safe. Subsequent compatible application rollbacks use the existing same-environment mechanism.
- At accepted observation completion, stop only the verified legacy site/database services and disable their automatic restarts. Check whether databases, HAProxy frontends, wildcard certificates, or media paths are shared before removing a site-specific dependency. Preserve all agreed offline backups; do not delete historical source directories, volumes, buckets, or unrelated services.
- Verify the production website, RSS, artwork, audio, and downloads after the legacy services are stopped. Public serving and certificate renewal must work without WordPress/podPress or home pfSense. Headscale and MinIO remain intentionally home-hosted operations dependencies; record their recovery role separately.
- Mark M6 complete only after the release matrix, observation, retirement, and accepted residual risks are recorded. Then plan M7, or resume the owner-selected R2 work if sequencing changed.

## Validation and evidence format

Each evidence record includes `schemaVersion`, UTC observation time, operator/source, exact release commit and Verify/deploy run where applicable, environment/hosts, named checks with passed/failed/pending outcomes, expected/observed counts or hashes, and unresolved issues. Capture before/after configuration privately; publish sanitized evidence only. A pending check is never encoded as passed.

For repository changes, begin with relevant focused tests and finish the existing canonical gate:

```sh
pnpm check:content
pnpm check:thumbnails
pnpm check:feed
CI=1 pnpm verify
```

The current workspace's separate Docker daemon requires `NUREVOLUTION_DOCKER_ADDRESS=172.18.0.2` for the full gate. Use the documented pinned toolchain; no production credentials are required for CI. Documentation-only planning is checked with targeted Prettier and `git diff --check`; it does not require repeating the complete runtime suite.

For live checks, reuse `audit-http`/`check-assets` from the verified deployment bundle and the existing media, feed, rollback, and backup runbooks. Record successful main verification separately from live/device acceptance. Tests of a temporary resolver prove candidate delivery; public-DNS probes and real subscriptions prove cutover behavior. Both are needed.

## Planning completion and handoff

- [x] Current main and deployed preview verified; stale milestone status identified.
- [x] Existing host/workflow transition constraints inspected and planned.
- [x] Owner confirmed WordPress is unchanged and can stay frozen (2026-09-12).
- [x] Owner chose current-player cutover before M7 (2026-09-12).
- [ ] Final delta, device/client acceptance, operations decisions, and transition rehearsal completed.
- [x] Owner authorized continuing production cutover (2026-09-12); legacy fallback remains available.
- [ ] Candidate accepted and public production cutover executed.
- [ ] Observation completed, WordPress services retired, final evidence committed.

Production environment preparation is recorded above. No production traffic has switched and no legacy service has stopped.
