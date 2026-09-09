# Operational checks and incidents

Use HTTPS health plus feed/media probes, container restart status, Caddy certificate expiry/renewal logs, disk/inode/log usage, and DigitalOcean transfer/budget usage. These are operational checks; no listener analytics is added. Logs rotate locally at 5 MiB across three files per configured service. Review operational log retention and avoid unnecessary query/IP collection.

Measure resource thresholds on the selected shared 1 GB host. Proposed warnings are 80% filesystem use and 80% included transfer; choose critical thresholds and notification destination with the owner. Account for the 6.34 GiB archive, staged copies, current/previous images, OS, logs, backup cache, and other sites. Included transfer is shared with other workloads; record real monthly usage before assuming the 1 TB allowance is sufficient.

For unavailable pages/feed, inspect the app health/exit/OOM state and deployment journal. Restore the compatible previous image using [the rollback procedure](rollback.md). Keep the media server and unrelated sites running. For missing/truncated media, compare the manifest's exact size/hash at the origin, verify HEAD/206/416 and attachment headers, and check DNS/proxy routing; never rewrite or re-encode a historical MP3 as a quick fix.

For TLS failure, inspect the persisted ACME state, token scope, DNS propagation, and Caddy logs; use [the TLS runbook](tls.md). Do not disable Full (strict) or certificate verification. For backup failure, retain the last known snapshot, investigate MinIO reachability/credentials/disk/capacity, and repeat [restore verification](backup-restore.md) before treating recovery as available.

Record incident start/end, affected endpoints, selected image/configuration, recovery result, and any pending public/device checks. Operator identity, alert destination, observation period, and M6 cutover/rollback responsibility remain inputs to the live handoff.
