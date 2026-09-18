# Completed cutover and legacy recovery history

Production cutover completed on **2026-09-12 at 21:49 UTC**. The [M6 evidence](../milestones/evidence/M06-cutover.json) identifies the accepted release, DNS changes, public/LAN checks, and backup. Production is the only hosted deployment environment. Subsequent releases use [normal verified promotion](../DEPLOYMENT.md) and [application rollback](rollback.md).

**M6 closed on 2026-09-18.** The owner confirmed that the old site and database are retired and their backups are confirmed. WordPress is no longer a running fallback. Use [normal application rollback](rollback.md) for compatible application regressions; recovery from legacy backups would require deliberate restoration and validation. The historical DNS procedure below is not a ready-to-run recovery path. See the [closure evidence](../milestones/evidence/M06-retirement.json).

## Observation - accepted and closed

The original plan called for immediate, 24-hour, and observation-end checks. The owner accepted the observation outcome and requested closure on 2026-09-18 after confirming retirement. Fresh production probes passed. This does not invent an unrecorded 24-hour checkpoint or claim an exactly seven-day observation window.

The owner accepted mobile testing for launch and subsequently completed Podcast Addict loading/seeking for all 55 episodes. Old-subscription refresh and directory observations remain unverified. Safari 14.3 compatibility is separate work, current physical Safari remains untested, and assistive checks are deferred future enhancements. These are recorded limitations outside M6, not additional passing tests.

## Historical public fallback - requires restoring retired services

An unexplained GUID/enclosure/count change is an immediate fallback trigger. TLS/feed/media failures on two independent probes one minute apart, repeated attributable playback/download failures, or repeated OOM/restart loops call for fallback unless a verified correction is ready within five minutes. A cosmetic defect alone does not trigger DNS rollback. Record the operator's decision and evidence.

Prefer a compatible production app rollback for application regressions. If public fallback to frozen WordPress is needed, first confirm that the legacy runtime and certificates still serve the saved feed and media correctly, and that no newer publication would be lost. Save current DNS and release state before changing anything.

Restore the exact saved apex/podcast DNS types, values, TTLs, and proxy flags from the private cutover capture. The original apex was A `136.49.253.125` (DNS-only); the podcast host was a proxied CNAME to `nurevolution.net`; www remained a proxied CNAME to the apex. Recheck current records and account for intervening authorized changes before applying that historical baseline. Restore the owner's saved LAN overrides only if needed for that fallback. Preserve unrelated records and keep Full (strict).

Verify the frozen WordPress feed/media through ordinary public and LAN resolution as caches expire. Keep the production media available while clients may retain its address. DNS reversal is not immediate. Public subscriber GUIDs, enclosure URLs, and historical bytes must remain unchanged.

## Legacy retirement - completed

The owner confirmed retirement of the old WordPress site and database and confirmed their backups on 2026-09-18. Preserve retained recovery material and historical migration evidence; no deletion is part of milestone closure. Headscale and MinIO remain intentionally home-hosted operations dependencies. The closure records owner confirmation without claiming an independent inspection of legacy autostart settings or a new legacy restore.
