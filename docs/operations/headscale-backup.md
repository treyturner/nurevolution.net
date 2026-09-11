# Headscale backup to Google Drive

The owner configured rclone remote `gdrive.fracturetrey` in `/boot/config/plugins/rclone/.rclone.conf` and installed restic 0.19.1 at `/usr/bin/restic` on Unraid. This backup covers only `/mnt/cache/appdata/headscale/{config,data}`. The separate DigitalOcean backup goes to MinIO; it cannot recover Headscale after loss of the Unraid server.

Use repository `rclone:gdrive.fracturetrey:Headscale/restic`. [Restic encrypts the repository before sending it through rclone](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html#other-services-via-rclone). Its encryption password is separate from Google OAuth and from the site's MinIO/restic credentials. Save it in the owner's password manager as **Headscale — restic encryption password (Google Drive)**. Recovery also needs access to the Google account and this repository path; a new rclone authorization can replace lost local OAuth configuration.

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

The helper applies retention and prunes only the `vault` host / `headscale` tag group. [Weekly and monthly retention overlap](https://restic.readthedocs.io/en/stable/060_forget.html); this does not promise seven distinct copies.

Add an Unraid User Script named `backup_headscale`, schedule it weekly at a quiet time, and also run it after configuration/policy/key changes:

```bash
#!/bin/bash
set -euo pipefail
/bin/bash /mnt/cache/appdata/headscale-backup/backup.sh backup
```

Keep this separate from `isolate_headscale_network`, whose schedule remains Disabled because `/boot/config/go` loads that firewall before Docker starts. Review User Scripts output and the timestamp in `last-success.json`; the DigitalOcean Discord notifier does not monitor this separate Unraid job. No notification is sent by these helpers.

## Recovering a failed Unraid host

Recover the password from the owner's password manager, install the pinned restic/Headscale versions, and reconnect rclone to the same Google account. Initialize neither a replacement repository nor replacement server keys. Use the repository's snapshot list, restore to a private empty directory, and run the isolated check above. Reinstall the saved Headscale Compose/configuration and firewall/boot setup from this repository, with the restored config/data directories and their ownership preserved. Before starting the replacement live service, stop or isolate the previous instance, restore HAProxy/DNS/STUN routing, and verify the existing droplet reconnects. Finally, verify a temporary deployment enrollment and expire any credentials affected by the failure. Public operator SSH remains available independently of Headscale.

The helpers' local tests use real restic encryption and rclone transport with a disposable local backend, lifecycle fault injection, and a real isolated Headscale server. Live Google Drive upload, recovery of the owner's actual node state, and scheduling require the Unraid results above.
