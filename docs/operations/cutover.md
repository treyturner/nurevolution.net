# Production cutover

Status: **First production cutover completed on 2026-09-12 at 21:49 UTC.** The [cutover record](../milestones/evidence/M06-cutover.json) identifies the accepted release and completed checks. Production is enabled, preview is disabled, and WordPress remains frozen/running during observation. The sequence below documents the first conversion and recovery procedure; do not rerun its preview-conversion steps against the accepted production state. Subsequent releases use normal verified production promotion. Observation and legacy retirement remain open.

The owner keeps WordPress frozen and its existing services, configuration, database, uploads, and episode files available for fallback. The agent performs accessible repository, droplet, and DNS operations. The owner handles Cloudflare settings outside the DNS token's scope, home DNS, physical devices, and eventual legacy retirement. Seven days of observation is proposed; duration and retirement timing remain pending owner confirmation.

## Release and access prerequisites

- Merge the accepted fixes, then select the successful **push to main** Verify run and its full commit. Verify `release-<commit>` with its own `deploy.mjs verify-release`. Retain the exact bundle and images. PR checks alone cannot authorize an artifact for promotion.
- Deploy that candidate to preview first and finish the available device checks. The Android copy check uses inline success feedback; failure feedback remains visible. Investigate any repeatable download warning on the actual phone. Automation verifies saved bytes and filenames but does not reproduce Brave's native permission UI.
- Confirm public feed and both legacy aliases work with non-browser user agents. The observed Cloudflare 1010 denial was resolved on preview by the owner’s feed-specific Browser Integrity Check Configuration Rule; repeat canonical-host checks after cutover. The account DNS token cannot edit this setting. Preserve Full (strict).
- GitHub `production` exists. `DEPLOY_HOST=100.64.0.1`, `DEPLOY_USER=nurevolution-deploy`, and `HEADSCALE_URL=https://headscale.treyturner.info`. Install `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`, and `HEADSCALE_AUTH_KEY` without printing their values. Pin the existing ED25519 fingerprint `SHA256:Oubqo79ywI0Qxz0kWLbWLOj/UoUYmbQc6ZLqucKQB50`; never widen public SSH. Keep `DEPLOYMENT_ENABLED=false` and `CUTOVER_ENABLED=false` during preparation.
- Obtain remaining device/client observations and record unavailable devices or accepted deferrals. An existing podcast subscription is refreshed after the public switch; do not submit a new show or subscribe it to preview as a substitute.

## Capture and certificate preparation

Save private, timestamped copies under `/srv/nurevolution/cutover/<timestamp>/`, outside the web/media roots. Include `profile.json`, `tooling/`, both environment state directories, accepted release bundle references, `/srv/edge/config/caddy.json`, `/etc/hosts`, and the exact current app/container/image identity. Keep the accepted preview Compose file and record its environment from `state/preview/current.json`. Do not print secret files or full container environments. Run the normal backup service and record its accepted snapshot/check before changing the slot.

Capture public DNS with record IDs, types, values, TTL, and proxy flags. The 2026-09-12 baseline is:

| Name                               | Existing public record            | Cutover target                                       |
| ---------------------------------- | --------------------------------- | ---------------------------------------------------- |
| `nurevolution.net`                 | A `136.49.253.125`, DNS-only      | A `159.89.86.21`, proxied                            |
| `www.nurevolution.net`             | CNAME `nurevolution.net`, proxied | Unchanged; candidate redirects to canonical HTTPS    |
| `podcast.nurevolution.net`         | CNAME `nurevolution.net`, proxied | A `159.89.86.21`, DNS-only                           |
| `preview.nurevolution.net`         | A `159.89.86.21`, proxied         | Unchanged DNS; app slot is retired during transition |
| `podcast-preview.nurevolution.net` | A `159.89.86.21`, DNS-only        | Unchanged DNS; no ongoing preview service promised   |

Refresh this baseline immediately before writing. Abort on unexplained concurrent changes. Preserve MX/TXT, unrelated records, and other sites. Check for AAAA records and authoritative TTLs. The media record must be a direct DNS-only A record: pointing it at the proxied apex would retain the Cloudflare path.

The shared edge must already have trusted certificates for the canonical website and podcast host. The `www.nurevolution.net` addition and trusted handshake were completed on 2026-09-12, with backups before and after; see [host preparation evidence](../milestones/evidence/M06-host-preparation.json). For a replacement host, add `www.nurevolution.net` to the existing DNS-01 policy's subjects and explicit certificate automation list, following [the bootstrap example](../../deploy/caddy/initial.example.json). Do not replace the live operator configuration with the example. Acquire the site lock followed by the edge lock, validate a complete candidate config using the running Caddy, atomically install it, and reload gracefully. Preserve all unrelated routes and existing certificate state. Release only locks acquired by this operation. Check the trusted `www` certificate directly at `159.89.86.21`, retaining the hostname/SNI; record issuance before DNS cutover.

## Convert the single application slot

The measured production profile is:

```json
{
  "environment": "production",
  "webOrigin": "https://nurevolution.net",
  "mediaOrigin": "https://podcast.nurevolution.net",
  "appMemoryMiB": 256,
  "reserveMemoryMiB": 192,
  "minimumFreeDiskMiB": 2048,
  "readinessSeconds": 60
}
```

1. Disable preview's GitHub `DEPLOYMENT_ENABLED`. Verify there is no active/queued deployment or backup, no site/edge lock, and no pending journal in either environment. Record available memory/disk and current transfer usage. Do not treat the historical M5 capacity result as a current reading.
2. Install `deploy.mjs` and `renderer.sha256` from the selected verified release into `/srv/nurevolution/tooling/`, preserving ownership/modes and the saved preview versions. Verify hashes against the release configuration. The `www` renderer change requires matching installed tooling before promotion; uploading only release data does not update it.
3. Prepare an identifiable block in the backed-up droplet `/etc/hosts` mapping **only** `nurevolution.net`, `www.nurevolution.net`, and `podcast.nurevolution.net` to `159.89.86.21`. Reject conflicting existing entries rather than appending an ambiguous override. Confirm `getent` and Node's actual DNS lookup resolve to the candidate. HTTPS must still use the real hostname and validate its certificate. Public DNS remains on WordPress.
4. Acquire the site lock followed by the shared edge lock. Recheck journals and actual containers. Stop/remove only the recorded `nurevolution-preview` app using its saved Compose file and profile environment. Do not remove networks, volumes, media, images, or the edge. Verify its app/network alias is absent before starting production. Install the production profile and create `/srv/nurevolution/production-enabled`. Preserve preview history; never copy it into `state/production/current.json` or `previous.json`. Release the locks before the normal deployment transaction acquires them.
5. Set production's two GitHub gates to `true`. Dispatch **Deploy verified release** from `main` with `environment=production`, the selected `verify_run_id`, and full `source_commit`. The normal helper performs locked image/configuration checks, starts the production project, tests canonical HTTPS/media, and records acceptance. Observe its completion; a started container alone is insufficient.
6. Validate candidate delivery externally with controlled resolution as well as on the droplet. Include the exact health identity, all 55 pages/download mappings, all public assets, feed/alias semantics, representative full/resumed transfers, and `www` redirects preserving paths/queries. The preview app is now unavailable; public WordPress remains available until the following DNS step.

### Failure before public cutover

Disable production promotion. Save the failed run, current/previous/last-attempt/pending records, and current route. If the first deployment reports `undeployed`, verify no production app remains and no journal is unresolved. If a journal remains, use [interrupted-deployment recovery](rollback.md); never delete a live lock or retry blindly.

There is no automatic production predecessor on the first deployment. To restore preview, explicitly reconcile under the same locks: stop only any confirmed production app, archive its state outside the active state tree, restore the saved preview profile/tooling/Compose/edge route, remove the production marker, and restart the exact saved preview image with its accepted profile environment. Preserve the original preview history. Restore the temporary hosts-file change, validate preview's exact health/feed/media identity, then reopen preview promotion. Public WordPress DNS remains unchanged throughout this recovery.

## Switch and check public traffic

1. With the candidate accepted, update the saved apex A record and replace the saved podcast CNAME with the direct DNS-only A record. Apply only the reviewed fields/records; compare each record to its captured baseline immediately before writing. Record the actual before/after IDs and time. Leave `www` pointing to the apex.
2. Ask the owner to remove or update local DNS overrides for **both** `nurevolution.net` and `podcast.nurevolution.net` that currently point to pfSense. Preserve the saved overrides for fallback. Do not change Headscale/MinIO or unrelated HAProxy routing.
3. From outside the home/origin network, use ordinary public resolution to verify trusted TLS, production health identity, canonical pages, RSS and aliases, `www` redirects, artwork, audio HEAD/ranges, and attachment saves. Confirm production lacks preview's `X-Robots-Tag`. Repeat with machine user agents through Cloudflare and check cache/ETag behavior. Verify the same paths on the owner's LAN without granting local-network permission.
4. Remove only the temporary hosts-file block after public resolution/acceptance succeeds. Preserve any unrelated intervening edits and prove Node now uses ordinary DNS. Record cleanup on every success/failure path.
5. Refresh the owner's existing podcast subscription and record episode count/identity, artwork, play/download, and duplicate/missing results. Run the external feed validator against the unchanged canonical URL. Complete a new normal encrypted backup and record its accepted snapshot/check.

An unexplained GUID/enclosure/count change is an immediate fallback trigger. TLS/feed/media failures on two independent probes one minute apart, repeated attributable playback/download failures, or repeated OOM/restart loops call for fallback unless a verified correction is ready within five minutes. A cosmetic defect alone does not trigger DNS rollback. Record the operator's decision and evidence.

For public fallback, restore the exact saved apex/podcast DNS types, values, and proxy flags, then the owner's local DNS overrides. Verify the frozen WordPress feed/media through ordinary resolution as caches expire. Keep the candidate media available while clients may retain its address. DNS reversal is not immediate, and a later content publication requires a reconciled legacy fallback before reverting. Subsequent application-only rollback uses the accepted production history and [normal rollback](rollback.md).

## Observation and retirement

Record checks immediately, after 24 hours, and at the agreed observation end: health/feed/media, resource/restart state, certificate coverage, backups, transfer usage, and actual clients. Keep WordPress frozen and running during observation. When the owner accepts retirement, identify shared dependencies, stop only the legacy site/database services, and disable their restarts. Preserve historical source directories, configuration, dumps, uploads, episode files, and recovery copies. Recheck public website/feed/media after those services stop. M6 completes only after this retirement and the final evidence/handoff are recorded.
