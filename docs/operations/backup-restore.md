# MinIO backup and restore

The owner selected MinIO and confirmed backups after content changes plus weekly, retaining four weekly and three monthly snapshots. Bucket and policy creation are deferred until the milestone handoff. No bucket, credentials, timer, notification, or live restore is claimed to exist yet.

Use restic **0.19.1**, installed from its official release with the release checksum verified. Its [S3-compatible/MinIO backend](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html#minio-server) supports the existing server. Create a dedicated bucket/prefix and identity with the object/list/delete permissions restic needs inside that destination; keep it separate from other MinIO data. Use trusted HTTPS and a recoverable restic encryption password distinct from the MinIO access key. Configure [backup.environment.example](../../deploy/backup.environment.example) as `/etc/nurevolution/backup.env` with owner-only access. Keep recovery credentials outside the droplet.

Initialize the repository explicitly after checking its endpoint and bucket. Install [backup.service](../../deploy/backup.service) and [backup.timer](../../deploy/backup.timer) as `nurevolution-backup.service` and `nurevolution-backup.timer`. Create `/var/cache/nurevolution-restic`, ensure the paths in the service are present, and test the service before enabling its timer. The backup command takes site/edge locks, uses one read worker and bounded Go memory/CPU, backs up media/release state/profile/tooling and edge config/ACME data, checks repository structure, then applies retention. It records the snapshot ID only after success. Restic encryption and content hashing apply to uploads; `check` alone is not a full-data restore test.

Preview retention selection before enabling automatic removal:

```sh
restic forget --tag nurevolution --host nurevolution --group-by host,tags \
  --keep-weekly 4 --keep-monthly 3 --dry-run
```

This is an independent restic repository, not a MinIO lifecycle rule that deletes chunks underneath it. Restic's [retention grouping](https://restic.readthedocs.io/en/stable/060_forget.html) uses the explicit host/tag group. Routine backups forget expired snapshots but do not prune data packs on the small production host. Reclaim unreferenced packs with a separately measured operator maintenance run after retention/restore checks; record actual backup storage growth.

Trigger the same backup service after content changes and require its recorded successful snapshot before publication is considered complete. Weekly backups bound ordinary configuration/state loss to about seven days; newly published content has an explicit backup checkpoint. A four-hour host recovery target is still proposed and must be measured with the actual MinIO connection.

For rehearsal, restore an explicitly recorded snapshot into an **empty** non-served directory or replacement host. Run `restic check --read-data`, restore the snapshot with `restic restore SNAPSHOT_ID --target EMPTY_DIRECTORY`, then run `deploy.mjs check-assets` against the restored media and its saved manifest. Compare every asset hash, identify/retrieve the saved image digests and source commit, and start the approved app with restored configuration and ACME state. Do not overwrite another site's live config during this exercise. Detect missing/corrupt backup data and record elapsed time, snapshot ID, 156-file hash comparison, TLS persistence, and recovered health/feed/media checks.

The alert destination is still needed. Until failure notifications are configured and observed, inspect systemd failures and `state/backup.json` manually; do not call this unattended backup monitoring. A source-workstation copy or same-disk staging directory does not establish independent restore readiness.
