# Owner acceptance and compatibility observations - 2026-09-18

This record updates the current acceptance position without rewriting historical cutover or test evidence. Sources are the owner's reports in the project conversation and the limited diagnostic checks described below.

## Completed and deferred items

- The owner enabled Dependabot security alerts. This supersedes the September 17 finding that alerts were disabled. The workspace integration could not independently read the setting on September 18 because GitHub returned `Resource not accessible by integration`; the enabled status is owner-reported.
- The owner completed loading and seeking for every episode in Podcast Addict, covering the 55-episode archive. Client version, complete downloads, full-length playback, and refresh of a pre-migration subscription were not reported. Do not treat these additional behaviors as tested by the load/seek observation.
- The owner deferred assistive-technology checks as future enhancement work, not a legacy-parity or WordPress-retirement gap. Existing accessibility behavior and automated checks remain in place; no screen-reader testing or complete conformance result is claimed.

## iPad Safari observation

The owner's only available Safari device is an iPad Pro running iPadOS 14.3. The site renders, but playback does not begin. Tapping a track changes its background highlight without moving the active-track marker; the player remains at `00:00 / 00:00` and displays `Choose an episode to listen.`

That message belongs to the player's initial `idle` state. The server renders it before client initialization. The browser normally creates the player, selects the episode, assigns the audio source, and leaves that state. A CSS hover/focus background can respond to a tap even when the JavaScript application has not initialized.

Diagnostic observations on September 18:

- The live Ruminate page contains an import map resolving `#entry` to the Nuxt entry bundle. Its initial server-rendered audio element has no source, and the initial status contains the idle message.
- Safari added import-map support in 16.4, later than the owner's installed version. See [WebKit's Safari 16.4 release notes](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/).
- Removing the import map from the live HTML in an isolated Playwright browser context reproduced an application startup failure: `Failed to resolve module specifier "#entry"`. This demonstrates an incompatible startup dependency; it is not an emulation of Safari 14.3 or a complete diagnosis of every possible incompatibility.
- The project uses Vite 8.2.2 and has no older-browser build target override. Vite's default build target includes Safari/iOS 16.4. See [Vite browser compatibility](https://vite.dev/guide/build#browser-compatibility).
- The player source selector retains the original MP3 for Safari. The observed startup barrier precedes selection of either the original or virtual playback source.

Supporting Safari 14.3 would require an explicit older-browser target, compatible entry loading, an audit of runtime APIs and CSS, and a production-build test on the actual iPad. A clearer fallback for unsuccessful initialization is also worth addressing. Neither change is implemented by this documentation update. Current Safari on physical Apple hardware remains untested; the older-device result does not establish its behavior.

## M8 workspace device retest

On September 18, the owner tested the PR #56 workspace preview on the iPad and reported that playback was working. This was commit `18a025c`, not a production deployment. The owner also identified two remaining issues: a page-wide focus outline after tapping and a current-track highlight that moved back briefly after seeking, including after a paused seek followed by Play.

Temporary development-only event capture on The Dark Prophet confirmed both causes. The focused element was `main-content`. Safari reported track 2's seek complete at `357.514467`, then reported `357.344128849` on the first advancing playback update. Similar rollbacks occurred at track 3 (`558.371338` to `558.153070849`) and track 4 (`826.145714` to `825.823665112`), before the clock advanced across each boundary again. This was not a change in authored timestamps. The browser identified itself as desktop-mode Safari 14.0.2; the device's iPadOS 14.3 version is owner-reported.

PR #56 removes the outline from the non-interactive content container while retaining control focus rings, and adds a bounded track-identity guard for confirmed-seek clock rollback. Automated regressions use the captured clock values. The owner then retested `fc11e20` on the iPad and confirmed that both the track bounce and page border were fixed. The remaining acceptance checklist is still pending; this observation does not establish dialog, restoration, untimed-episode, or current-Safari acceptance.

The owner also confirmed that Download MP3 saves successfully. Before the range fix, choosing Safari's separate **View** option instead could show an unseekable live-style player or a playback-failure icon on the workspace preview. The local Node download fallback streamed full responses without byte ranges; production uses a different Caddy download path, verified read-only to return `206`, `Accept-Ranges: bytes`, and the requested two bytes. That difference is a likely explanation, not proof of the native viewer's complete failure mechanism. Production native-viewer behavior remains untested. Normal website playback uses the original range-capable media URL. After the owner reported the failure again on the Coder preview, direct GET tests confirmed that both Ruminate and The Dark Prophet ignored `Range: bytes=0-1` and returned the full 200 representation. The application handler dropped the Range header and only accepted full upstream responses. The Safari PR now adds normalized single-range forwarding, validated partial responses, 416 handling, and regressions for native media loading/seeking as well as saved downloads. The owner subsequently confirmed that Download MP3 -> View now loads a working player on the iPad using the fixed Coder preview (`01bd6f9`, including `7d7ffcb`). This confirms the reported View failure is resolved; production native-viewer behavior remains untested.

## Unraid reboot follow-up

After the owner reported an Unraid reboot on September 18, external Headscale health/TLS, the existing droplet client, self-hosted relay/STUN checks, MinIO health, authenticated access to the four retained backup snapshots, and production uptime probes passed. The latest snapshot remains the verified September 17 backup; this check did not create another backup or repeat a restore. The droplet backup timer is active and enabled.

The owner supplied Unraid-local evidence: container `headscale` restarted healthy with `unless-stopped`; the firewall invocation remains before `emhttp`; the expected hook and rules are installed. Both host-positive test connections were blocked from Headscale, with DROP packets increasing from 5 to 11. Restic 0.19.1 and rclone remain installed. Headscale/firewall boot persistence is verified. Both saved and active User Scripts schedules retain the weekly Headscale backup and disabled firewall schedule. The executable weekly launcher, Sunday 04:30 Unraid-local root cron entry, and running cron daemon also passed. This verifies scheduling, not a new backup run. See the [post-reboot evidence](../milestones/evidence/M06-unraid-reboot.json).

## M6 closure

The owner confirmed the old site and database are retired and their backups are confirmed, accepted a four-hour recovery target, and requested M6 closure on September 18. Safari 14.3 fixes are explicitly separate work. Fresh production health/feed/media/certificate checks passed, with the serving release unchanged at `c54adaef5b3f1cc75bf24c1b22cb6e194ea21742`.

[M6 is closed](../milestones/M06-cutover-and-retirement.md). The [retirement record](../milestones/evidence/M06-retirement.json) preserves owner-reported retirement/backup confirmation, accepted observation, and the distinction between a four-hour objective and an unmeasured replacement-host recovery time. Remaining device/client observations, assistive enhancements, recovery rehearsal, and ongoing cost/capacity review continue outside M6. Retained legacy backups are offline recovery material; a running WordPress fallback is no longer assumed.

## Scheduled production backup

A September 18 journal inspection confirmed that the weekly production backup started automatically on September 13 at 04:20:21 UTC and finished successfully at 04:20:27 UTC. The repository check passed; the recorded snapshot was `23fd4e9a4163be58637004420a4df12c79256c5e33df5b978bfe5e6ce327d7e2`. This closes the old first-scheduled-run observation. The September 17 post-deployment backup and September 18 authenticated repository read are recorded separately in the reboot evidence. No backup was triggered for this documentation reconciliation.
