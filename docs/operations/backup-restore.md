# MinIO backup and restore

The owner selected MinIO and confirmed backups after content changes plus weekly, retaining four weekly and three monthly snapshots. The owner supplied successful creation output for the `nurevolution-backups` bucket and `nurevolution-backup` policy/user; the user is enabled with only that policy and no group memberships. Droplet credentials and repository initialization are verified, and a small encrypted fixture backup/restore passed. The full archive/application backup, timer, notifications, and complete recovery rehearsal remain pending.

Use restic **0.19.1**, installed from its official release with the release checksum verified. Its [S3-compatible/MinIO backend](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html#minio-server) supports the existing server. Create a dedicated bucket/prefix and identity with the object/list/delete permissions restic needs inside that destination; keep it separate from other MinIO data. Use trusted HTTPS and a recoverable restic encryption password distinct from the MinIO access key. Configure [backup.environment.example](../../deploy/backup.environment.example) as `/etc/nurevolution/backup.env` with owner-only access. Keep recovery credentials outside the droplet.

## Dedicated bucket and identity

The owner supplied `https://minio.treyturner.info` as the S3 API endpoint and will administer the existing MinIO installation using `mc` inside its container. The administrative alias is `primary`, and the owner reports `mc RELEASE.2025-08-13T08-35-41Z` (commit `7394ce0dd2a80935aded936b09fa12cbb3cb8096`), which supports the commands below. Never print the alias configuration or credentials into review output. The created bucket is `nurevolution-backups`, with the dedicated `nurevolution-backup` user and policy. The following creation procedure is retained for a fresh setup; skip it for the current deployment. Confirm those names are unused before creation: `mc mb` must create a new bucket, and `mc admin user info` / `mc admin policy info` must specifically report the corresponding identity/policy is absent. An access or connection error does not establish absence. If any name already exists, inspect it before changing anything; do not overwrite an existing user or policy.

Copy [minio-restic-policy.json](../../deploy/minio-restic-policy.json) into the container. It grants bucket listing/location and object read/write/delete plus multipart cancellation only within the new bucket. The first five permissions follow [restic's S3 example](https://restic.readthedocs.io/en/stable/080_examples.html#setting-up-restic-with-amazon-s3); multipart cancellation permits cleanup of interrupted large uploads. No server administration, bucket creation/deletion, or access to other buckets is granted. Leave the identity outside existing groups and attach only this policy. A normal private bucket without object locking or automatic object-expiry rules matches the planned restic retention procedure.

After checking for name conflicts, run these individually, stopping on any error:

```sh
MINIO_ALIAS=primary
mc mb "$MINIO_ALIAS/nurevolution-backups"
mc admin policy create "$MINIO_ALIAS" nurevolution-backup /tmp/nurevolution-restic-policy.json
mc admin user add "$MINIO_ALIAS" nurevolution-backup
mc admin policy attach "$MINIO_ALIAS" nurevolution-backup --user nurevolution-backup
mc admin user info "$MINIO_ALIAS" nurevolution-backup
```

The user-add command prompts for the new secret key; use a separately generated password-manager secret and retain it there. Do not use JSON output for user creation, which can include that secret. Install it directly on the droplet as `AWS_SECRET_ACCESS_KEY` in the owner-only backup environment file; the access key ID is `nurevolution-backup`. Set `RESTIC_REPOSITORY=s3:https://minio.treyturner.info/nurevolution-backups`. Preserve the separately generated restic encryption password outside the droplet as well.

From the droplet, verify trusted HTTPS and API access before initialization. The owner reports HAProxy on pfSense forwards this hostname to MinIO port 9000 and filters bot-associated user-agents. On 2026-09-09, `/minio/health/live` returned 403 with the default curl user-agent but 200 with the actual pinned restic S3 user-agent, `MinIO (linux; amd64) minio-go/v7.0.98`, and with a browser-style user-agent. TLS verification passed. Use the actual backup client for authenticated checks; the curl denial alone does not establish a blocked backup path. Test backup/restore/delete in the dedicated repository and confirm the new identity cannot access another bucket before enabling scheduled backups. Bucket/policy creation or an unauthenticated health response alone is not a verified backup.

## Enter credentials on the droplet

The checked restic 0.19.1 binary and [backup-credentials.py](../../deploy/backup-credentials.py) are installed on the Ubuntu 26.04 droplet. The helper is `/usr/local/sbin/nurevolution-backup-credentials`, owned by root with mode 0700. Run it from the owner's interactive root SSH session:

```sh
/usr/local/sbin/nurevolution-backup-credentials
```

Enter the existing MinIO secret key, then a separate new backup-encryption password of at least 24 printable characters twice. Keep both in the owner's password manager. Input is hidden; neither secret belongs in chat, command arguments, or shell history. The helper creates `/etc/nurevolution/backup.env` and `/etc/nurevolution/restic-password` with mode 0600 in the root-owned 0700 directory. It refuses to replace existing credential files and does not initialize or access the repository. The environment file uses systemd quoting; do not source it as a shell script. Format handling for quotes, backslashes, dollar signs, and backticks was verified using dummy values with systemd on the actual droplet.

## Repository initialization and rehearsal

The current repository is initialized. A [small live fixture rehearsal](../milestones/evidence/M05-minio-fixture-restore.json) passed upload, full data verification, restoration with exact hashes, scope checks, and test-data cleanup from the droplet. It leaves zero snapshots; no production archive backup or weekly timer is active yet. The following initialization step is for a fresh repository.

Initialize the repository explicitly after checking its endpoint and bucket. Install [backup.service](../../deploy/backup.service) and [backup.timer](../../deploy/backup.timer) as `nurevolution-backup.service` and `nurevolution-backup.timer`. Create `/var/cache/nurevolution-restic`, ensure the paths in the service are present, and test the service before enabling its timer. The backup command takes site/edge locks, uses one read worker and bounded Go memory/CPU, backs up media/release state/profile/tooling and edge config/ACME data, checks repository structure, then applies retention. It records the snapshot ID only after success. Restic encryption and content hashing apply to uploads; `check` alone is not a full-data restore test.

All repository operations use two S3 connections, an 8 MiB target pack size, `GOMAXPROCS=1`, and `GOMEMLIMIT=96MiB`. Keep these bounds when running restore/check commands manually on this droplet. The full-archive rehearsal hit the service's 192 MiB cgroup limit with restic's default five connections and 16 MiB packs; the Go heap limit alone did not bound the complete process. [Restic's tuning guide](https://restic.readthedocs.io/en/stable/047_tuning_parameters.html) explains the additional buffer cost of connections and pack size. The revised limits still require full archive and running-application acceptance; the earlier small fixture result does not establish that capacity. The success record uses the snapshot ID returned by this backup's JSON summary, so a separate rehearsal snapshot cannot be mistaken for the new application backup.

Preview retention selection before enabling automatic removal:

```sh
GOMAXPROCS=1 GOMEMLIMIT=96MiB restic -o s3.connections=2 --pack-size 8 \
  forget --tag nurevolution --host nurevolution --group-by host,tags \
  --keep-weekly 4 --keep-monthly 3 --dry-run
```

This is an independent restic repository, not a MinIO lifecycle rule that deletes chunks underneath it. Restic's [retention grouping](https://restic.readthedocs.io/en/stable/060_forget.html) uses the explicit host/tag group. Routine backups forget expired snapshots but do not prune data packs on the small production host. Reclaim unreferenced packs with a separately measured operator maintenance run after retention/restore checks; record actual backup storage growth. If limiting S3 connections explicitly for that maintenance, `prune` requires at least two (`-o s3.connections=2`).

Trigger the same backup service after content changes and require its recorded successful snapshot before publication is considered complete. Weekly backups bound ordinary configuration/state loss to about seven days; newly published content has an explicit backup checkpoint. A four-hour host recovery target is still proposed and must be measured with the actual MinIO connection.

For rehearsal, restore an explicitly recorded snapshot into an **empty** non-served directory or replacement host. Run `restic check --read-data`, restore the snapshot with `restic restore SNAPSHOT_ID --target EMPTY_DIRECTORY`, then run `deploy.mjs check-assets` against the restored media and its saved manifest. Compare every asset hash, identify/retrieve the saved image digests and source commit, and start the approved app with restored configuration and ACME state. Do not overwrite another site's live config during this exercise. Detect missing/corrupt backup data and record elapsed time, snapshot ID, 156-file hash comparison, TLS persistence, and recovered health/feed/media checks.

## Discord failure notifications

The owner selected a Discord webhook; its secret URL must be entered directly on the droplet. Install [backup-alert.py](../../deploy/backup-alert.py) as root-owned `/usr/local/sbin/nurevolution-backup-alert`, mode `0700`, and [backup-alert.service](../../deploy/backup-alert.service) as `/etc/systemd/system/nurevolution-backup-alert.service`. The backup unit's `OnFailure` starts this notifier. Install the backup unit from the same revision and reload systemd before testing.

From the owner's root SSH terminal, run:

```sh
/usr/local/sbin/nurevolution-backup-alert configure
/usr/local/sbin/nurevolution-backup-alert test
```

The first command prompts invisibly and creates root-only `/etc/nurevolution/discord-webhook`; it refuses to overwrite an existing URL. The second sends one clearly labelled setup message. The URL is a credential and must stay out of Git, shell arguments, and logs. The notifier accepts the HTTPS Discord webhook endpoint, rejects redirects, suppresses mentions, and sends only a brief host/status message. It requests `wait=true` and requires a returned message ID: [Discord's default asynchronous response](https://docs.discord.com/developers/resources/webhook#execute-webhook) can otherwise omit errors for messages that were not saved. It does not upload backup logs or secrets. Failed delivery retries up to three service starts within five minutes; webhook delivery failure remains visible as a systemd failure.

Before enabling the weekly timer, verify both message delivery and the backup unit's failure-to-notifier wiring during the live rehearsal. Until those observations are recorded, inspect systemd failures and `state/backup.json` manually; do not call this unattended backup monitoring. A source-workstation copy or same-disk staging directory does not establish independent restore readiness.
