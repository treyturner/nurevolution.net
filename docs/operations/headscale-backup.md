# Headscale backup to Google Drive

The owner configured rclone remote `gdrive.fracturetrey` in `/boot/config/plugins/rclone/.rclone.conf` and installed restic 0.19.1 at `/usr/bin/restic` on Unraid. This backup covers only `/mnt/cache/appdata/headscale/{config,data}`. The separate DigitalOcean backup goes to MinIO; it cannot recover Headscale after loss of the Unraid server.

Use repository `rclone:gdrive.fracturetrey:Headscale/restic`. [Restic encrypts the repository before sending it through rclone](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html#other-services-via-rclone). Its encryption password is separate from Google OAuth and from the site's MinIO/restic credentials. Save it in the owner's password manager as **Headscale — restic encryption password (Google Drive)**. Recovery also needs access to the Google account, this repository path, and the existing Google OAuth client ID/secret. Reauthorize rclone with that same client ID if its local OAuth configuration is lost: the selected [`drive.file` scope grants access per application](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), so switching to a different OAuth application can hide the existing repository.

## Initial setup on Unraid

Install [backup.sh](../../deploy/headscale/backup.sh) and [check-restore.sh](../../deploy/headscale/check-restore.sh) into `/mnt/cache/appdata/headscale-backup/`, owned by root. Use directory mode 0700 and script mode 0700. Preserve LF line endings. The helper requires the existing Bash, Docker CLI, jq, GNU coreutils/findutils/tar, flock, rclone, and pinned restic installation.

Run these commands individually from an interactive root shell. Stop if any command fails:

```sh
/bin/bash /mnt/cache/appdata/headscale-backup/backup.sh password
/bin/bash /mnt/cache/appdata/headscale-backup/backup.sh init
/bin/bash /mnt/cache/appdata/headscale-backup/backup.sh backup
```

The first command prompts twice with hidden input for a new password of at least 24 characters and saves it as a root-only file. Do not put the password in chat, command arguments, or shell history. Initialization creates a new encrypted repository and refuses to replace an existing one. No additional rclone remote or Google scope is required for a folder created by this same remote.

The backup validates repository access before stopping anything. It locates the existing `services` project's Headscale container and checks its two source mounts. It briefly stops only that running container, copies the complete config/data directories, then restarts it and checks health **before uploading**. The copy includes SQLite WAL files and both private server keys. A capture failure attempts to restart the original service; an intentionally stopped service stays stopped. Do not run the first capture during a deployment or while editing Headscale configuration.

Accepted backups have a full snapshot ID in `/mnt/cache/appdata/headscale-backup/last-success.json`. An upload or repository-check failure does not advance that record. The temporary plaintext capture is removed when the helper exits. A host power loss or forced kill can leave it behind; inspect an existing `capture` directory and the service status before cleaning up that interrupted capture. The helper refuses to overwrite it. Retention is initially disabled.

## First restore rehearsal

Run a complete repository data check, restore the accepted snapshot to a new directory, and start an isolated copy:

```sh
/bin/bash /mnt/cache/appdata/headscale-backup/backup.sh check
hs_snapshot=$(jq -er .snapshotId /mnt/cache/appdata/headscale-backup/last-success.json)
/bin/bash /mnt/cache/appdata/headscale-backup/backup.sh restore \
  "$hs_snapshot" /mnt/cache/appdata/headscale-restore-check
/bin/bash /mnt/cache/appdata/headscale-backup/check-restore.sh \
  /mnt/cache/appdata/headscale-restore-check
```

The destination must not already exist or be inside the live Headscale directory. Restore checks every captured file hash. The final helper copies the restore into a disposable Headscale 0.29.3 container with **no network, ports, bind mounts, or volumes**. It checks server health, reads saved enrollment state without printing registration keys, verifies that both private server identities survived startup, and removes only that disposable container. The live service and the restored files remain unchanged. Its `restore-check.json` contains the snapshot ID, public node facts, counts, and pass/fail facts suitable for reporting. Confirm that the saved droplet node/address is present; an empty fixture database is not evidence of recovering the live deployment network.

Keep the restored copy private until this rehearsal is accepted. It contains credentials. After acceptance, remove only that known rehearsal directory. Do not substitute these checks for the owner-managed boot/firewall persistence check.

## Enable retention and scheduling after acceptance

Preview retention first, then explicitly enable the owner's four-weekly/three-monthly policy:

```sh
/bin/bash /mnt/cache/appdata/headscale-backup/backup.sh retention
install -m 600 /dev/null /mnt/cache/appdata/headscale-backup/retention-enabled
```

The `snapshots` command prints a JSON list of snapshot IDs, hosts, tags, and times. The `retention` command prints a JSON dry run with the policy and separate `keep`/`remove` lists; it does not delete anything. An empty repository produces explicit empty lists. Missing or failed report data produces an error. These reports use piped structured output so they do not depend on restic’s interactive terminal renderer.

The helper applies retention and prunes only the `vault` host / `headscale` tag group. [Weekly and monthly retention overlap](https://restic.readthedocs.io/en/stable/060_forget.html); this does not promise seven distinct copies.

Add an Unraid User Script named `backup_headscale`, schedule it weekly at a quiet time, and also run it after configuration/policy/key changes:

```bash
#!/bin/bash
set -euo pipefail
/bin/bash /mnt/cache/appdata/headscale-backup/backup.sh backup
```

Keep this separate from `isolate_headscale_network`, whose schedule remains Disabled because `/boot/config/go` loads that firewall before Docker starts. Review User Scripts output and the timestamp in `last-success.json`; the DigitalOcean Discord notifier does not monitor this separate Unraid job. No notification is sent by these helpers.

## Recovering a failed Unraid host

Recover the password from the owner's password manager, install the pinned restic/Headscale versions, and reconnect rclone to the same Google account using the existing OAuth client ID. Initialize neither a replacement repository nor replacement server keys. Use the repository's snapshot list, restore to a private empty directory, and run the isolated check above. Reinstall the saved Headscale Compose/configuration and firewall/boot setup from this repository, with the restored config/data directories and their ownership preserved. Before starting the replacement live service, stop or isolate the previous instance, restore HAProxy/DNS/STUN routing, and verify the existing droplet reconnects. Finally, verify a temporary deployment enrollment and expire any credentials affected by the failure. Public operator SSH remains available independently of Headscale.

The helpers' local tests use real restic encryption and rclone transport with a disposable local backend, lifecycle fault injection, and a real isolated Headscale server. On 2026-09-11, the owner completed the live Google Drive backup, full repository read, exact file restore, and isolated server check. [Live recovery evidence](../milestones/evidence/M05-headscale-backup-live.json) records snapshot `85bfee4396d9317649ee65e133448fcaed7f66368e6d0896701d27d812d316b2`, both server identities preserved, the droplet at `100.64.0.1`, and both saved enrollment keys. The owner configured the weekly User Script and root-only retention marker. The owner still saw silent interactive reports after installing the first progress-throttling correction, although that correction passed locally. The helper now formats piped restic JSON for both reports. Local tests cover real terminal and pipe output, empty repositories, and missing/failed report data. The owner confirmed both JSON reports on Unraid using helper commit `db838590f068e8ed173274657c7f2ac463aa9a04`: the verified snapshot is retained and no snapshots are selected for removal. Headscale backup, restore, retention reporting, and weekly scheduling are accepted; the later boot check remains pending.
