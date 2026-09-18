# Production maintenance history

For current operations and outstanding follow-ups, use [current status](../STATUS.md) and the [maintenance cadence](incidents.md#maintenance-cadence). The September 13 narrative below is historical: M7 has since shipped, M6 closed, and the first scheduled production backup was subsequently verified.

## September 13 operating context

The owner selected production plus local/workspace development, lowercase nurevolution branding, GitHub Actions uptime checks with the existing Discord destination, and routine droplet maintenance/reboots. Subsequent player releases are recorded in the M7 and deployment histories. Frozen WordPress and historical migration/cutover evidence remain available for fallback.

## Completed host work

- Before maintenance, the normal encrypted backup completed at 00:17 UTC with snapshot `20dfe501d80a7fb2f942f1c49d915cd626d3ddb9ada7e7add181f717e3e95695`.
- Ubuntu updates completed. The droplet rebooted at 00:24 UTC into `7.0.0-31-generic`; public health returned within 26 seconds. Follow-up checks found Docker, Tailscale, and the backup timer active, the app healthy, and no failed units. Private deployment address remains `100.64.0.1`; public SSH restrictions are preserved.
- Every one of the 156 serving media files matched its accepted size and SHA-256 before the duplicate upload staging copy was removed. Available disk increased to 22.25 GiB. Serving media, release images, and recovery copies remain intact. Duplicate Tailscale bootstrap downloads were also removed after comparing their binaries and key-entry helper with the installed copies.
- Both former rehearsal DNS records were deleted, with all unrelated records verified unchanged. Their Caddy certificate automation entries were removed through a locked, validated reload. Historical state/certificates and the pre-change DNS/config capture were moved to private `/root/nurevolution-maintenance-20260913`; deployment key files were renamed from their obsolete environment label to `github-deploy-*`.

## Release work and owner handoff

The maintenance branch adds lowercase share metadata, production-only deployment validation/workflow, external uptime checks, and an Unraid scheduled-backup alert wrapper. Release acceptance and production promotion must be recorded after the PR and trusted main verification complete; local checks alone do not update the public site. Signal may retain a cached card for an already shared URL after the metadata changes.

The owner deleted the obsolete GitHub environment after the workspace integration returned HTTP 403. The owner also supplied the revised Cloudflare feed exception: only the apex and www production hosts match, with GET/HEAD and the existing feed paths preserved. The DNS token cannot edit Configuration Rules (HTTP 403).

The owner installed/configured the Headscale `scheduled-backup.sh` wrapper on Unraid and updated the existing weekly User Script. Its live normal backup completed with snapshot `80c6d358e4fa399313ec56582b9be90d1c93538e28ea5576627e4f33ab673004`; Headscale restarted healthy. Configuration and successful backup sent no message. Failure delivery is covered by isolated tests; a live failure notification has not been triggered. The owner also installed the repository `UPTIME_DISCORD_WEBHOOK` secret; the first Actions monitor run follows merge. [Installation and recovery details](headscale-backup.md).

## M6 closure update - 2026-09-18

The owner confirmed retirement of the old site/database and their backups, accepted a four-hour recovery target, and requested M6 closure. The [retirement evidence](../milestones/evidence/M06-retirement.json) supersedes the observation/retirement and proposed-target items in the dated notes below. Safari 14.3 is a separate compatibility fix; assistive checks are deferred enhancements. Replacement-host timing and ongoing cost/capacity review remain operations follow-ups.

## Observations recorded on September 13 - historical

- Observe the first weekly scheduled droplet backup after cutover (next shown as 2026-09-13 at 04:09 UTC after reboot); manual backups and timer enablement/reboot persistence are verified.
- Complete the 24-hour cutover observation after 2026-09-13 at 21:49 UTC; agree the observation end before retiring frozen WordPress.
- Unraid firewall/Headscale startup verification completed after the owner-managed 2026-09-18 reboot. The [evidence](../milestones/evidence/M06-unraid-reboot.json) also verifies backup tools, the saved/active weekly schedule, its launcher, and cron. A whole replacement-host recovery time remains unmeasured.
- iPhone Safari, screen-reader, and existing-subscription comparisons remain unperformed. The owner accepted available mobile testing for launch.
- Review actual transfer and backup storage growth before changing capacity or committing to a total operational budget. No extra service purchase is part of this maintenance.
