# Cutover observation and WordPress fallback

Production cutover completed on **2026-09-12 at 21:49 UTC**. The [M6 evidence](../milestones/evidence/M06-cutover.json) identifies the accepted release, DNS changes, public/LAN checks, and backup. Production is the only hosted deployment environment. Subsequent releases use [normal verified promotion](../DEPLOYMENT.md) and [application rollback](rollback.md).

The owner keeps WordPress frozen and its existing services, configuration, database, uploads, and episode files available for fallback. The agent performs accessible repository, droplet, and DNS operations. The owner handles Cloudflare settings outside the DNS token's scope, home DNS, physical devices, and eventual legacy retirement. Neither the new operating policy nor staging cleanup authorizes deletion of WordPress.

## Observation

Record checks immediately, after 24 hours (**2026-09-13 at 21:49 UTC**), and at the agreed observation end: health/feed/media, resource usage, container restarts, backup results, client issues, and DNS behavior. Seven days was proposed; retirement timing remains an owner decision. The [maintenance record](maintenance.md) tracks completed operational work and outstanding observations.

The owner accepted mobile testing as sufficient for cutover and reported that a newly loaded feed looked correct. An existing-subscription comparison was unavailable; do not record it as passed. iPhone Safari and screen-reader observations also remain unperformed.

## Public fallback

An unexplained GUID/enclosure/count change is an immediate fallback trigger. TLS/feed/media failures on two independent probes one minute apart, repeated attributable playback/download failures, or repeated OOM/restart loops call for fallback unless a verified correction is ready within five minutes. A cosmetic defect alone does not trigger DNS rollback. Record the operator's decision and evidence.

Prefer a compatible production app rollback for application regressions. If public fallback to frozen WordPress is needed, first confirm that the legacy runtime and certificates still serve the saved feed and media correctly, and that no newer publication would be lost. Save current DNS and release state before changing anything.

Restore the exact saved apex/podcast DNS types, values, TTLs, and proxy flags from the private cutover capture. The original apex was A `136.49.253.125` (DNS-only); the podcast host was a proxied CNAME to `nurevolution.net`; www remained a proxied CNAME to the apex. Recheck current records and account for intervening authorized changes before applying that historical baseline. Restore the owner's saved LAN overrides only if needed for that fallback. Preserve unrelated records and keep Full (strict).

Verify the frozen WordPress feed/media through ordinary public and LAN resolution as caches expire. Keep the production media available while clients may retain its address. DNS reversal is not immediate. Public subscriber GUIDs, enclosure URLs, and historical bytes must remain unchanged.

## Legacy retirement

After the owner accepts the observation period, take and verify an independent final copy of the WordPress Compose/runtime configuration, database, uploads, and episode files. Record how to restore it. Stop the old workload only after that explicit retirement decision. Remove its obsolete routing and DNS overrides deliberately, without touching Headscale, MinIO, or unrelated home services. Keep the agreed recovery copy and historical migration evidence.
