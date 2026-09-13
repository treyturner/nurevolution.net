# Operational checks and incidents

Use HTTPS health plus feed/media probes, container restart status, Caddy certificate expiry/renewal logs, disk/inode/log usage, and DigitalOcean transfer/budget usage. These are operational checks; no listener analytics is added. Logs rotate locally at 5 MiB across three files per configured service. Review operational log retention and avoid unnecessary query/IP collection.

Measure resource thresholds on the selected shared 1 GB host. Proposed warnings are 80% filesystem use and 80% included transfer; choose critical thresholds and notification destination with the owner. Account for the 6.34 GiB archive, staged copies, current/previous images, OS, logs, backup cache, and other sites. Included transfer is shared with other workloads; record real monthly usage before assuming the 1 TB allowance is sufficient.

For unavailable pages/feed, inspect the app health/exit/OOM state and deployment journal. Restore the compatible previous image using [the rollback procedure](rollback.md). Keep the media server and unrelated sites running. For missing/truncated media, compare the manifest's exact size/hash at the origin, verify HEAD/206/416 and attachment headers, and check DNS/proxy routing; never rewrite or re-encode a historical MP3 as a quick fix.

For TLS failure, inspect the persisted ACME state, token scope, DNS propagation, and Caddy logs; use [the TLS runbook](tls.md). Do not disable Full (strict) or certificate verification. For backup failure, retain the last known snapshot, investigate MinIO reachability/credentials/disk/capacity, and repeat [restore verification](backup-restore.md) before treating recovery as available.

Record incident start/end, affected endpoints, selected image/configuration, recovery result, and any pending public/device checks. Trey owns incident decisions and Discord alerts. Repository/droplet changes can be handled through the workspace; Unraid and restricted Cloudflare settings require owner operation. The observation/retirement decision is recorded separately in the cutover runbook.

## External monitoring

[Production uptime](../../.github/workflows/uptime.yml) runs from trusted main every 15 minutes, offset from the hour, and supports manual dispatch. It checks the homepage, health/release identity, the canonical feed's 55-episode minimum, and one enclosure's exact one-byte range response. It also validates trusted origin/audio/Headscale TLS with a 14-day expiry warning. A failed check gets one retry before being reported. These small probes do not download whole MP3s or gather listener analytics.

Set repository secret `UPTIME_DISCORD_WEBHOOK` to the existing Discord destination; it is separate from environment deployment credentials. Incident and recovery changes are notified once using the previous run's `uptime-state` artifact, retained for seven days. A changed set of failures sends an updated alert. Unconfirmed notification delivery preserves the previous notification state so the next run retries. Deleting/expiring all state artifacts resets deduplication. Healthy first runs send nothing. The job does not create deployment records or join the private network.

Review failed workflow runs too: missing credentials, GitHub/artifact failures, or runner termination can prevent Discord delivery. [GitHub schedules are best-effort and public-repository schedules are disabled after 60 days without repository activity](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). This is a lightweight external check, not an independent monitoring SLA. Verify the workflow remains enabled during the monthly operations review; manually re-enable it after inactivity. GitHub/Discord outages can delay or prevent notifications.

Use `python3 deploy/uptime.py --check-only` for a read-only local probe without credentials, artifact access, or notifications. Changes to the host address, feed path, or protected archive minimum must update the probe alongside deployment configuration. The monitor samples one audio file; the complete media audit remains part of release verification.

## Maintenance cadence

Weekly: inspect both backup success timestamps, failed units, application restarts/OOM events, disk/inodes, and DigitalOcean transfer usage. Use 80% disk or transfer consumption as an investigation threshold; deployment independently refuses less than 2 GiB free disk. Monthly: review OS security updates/reboot requirements, pinned Node/Caddy/Tailscale/Headscale/restic releases, certificate renewal, monitoring enablement, and backup storage growth. Apply dependency upgrades through verification and normal production promotion; do not replace pinned container/runtime versions ad hoc.

Run a backup before host maintenance, honor deployment/edge locks, and verify public health/feed/audio, SSH/private-network access, and the backup timer after a reboot. The owner authorizes droplet reboots when maintenance needs them. Unraid is a separate shared host: verify its firewall boot persistence at the next owner-managed reboot. Repeat restore rehearsals after material backup/configuration changes and periodically review recovery credentials. The rehearsed component restores do not establish a measured four-hour replacement-host recovery promise.
