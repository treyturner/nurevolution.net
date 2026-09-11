#!/bin/bash
# Run on Unraid as root. Keep this file and the User Script in LF format.
set -Eeuo pipefail
umask 077

hs_root=${HS_BACKUP_ROOT:-/mnt/cache/appdata/headscale-backup}
hs_source=${HS_SOURCE_ROOT:-/mnt/cache/appdata/headscale}
hs_project=${HS_COMPOSE_PROJECT:-services}
hs_restic=${HS_RESTIC:-/usr/bin/restic}
export RCLONE_CONFIG=${HS_RCLONE_CONFIG:-/boot/config/plugins/rclone/.rclone.conf}
export RESTIC_REPOSITORY=${HS_REPOSITORY:-rclone:gdrive.fracturetrey:Headscale/restic}
export RESTIC_PASSWORD_FILE="$hs_root/restic-password"
export RESTIC_CACHE_DIR="$hs_root/cache"
export GOMAXPROCS=1 GOMEMLIMIT=128MiB
unset RESTIC_PASSWORD RESTIC_PASSWORD_COMMAND RESTIC_REPOSITORY_FILE RESTIC_PROGRESS_FPS

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ $EUID == 0 ]] || fail 'Run this helper as root on Unraid.'
[[ $hs_root == /* && $hs_source == /* ]] || fail 'Backup and source directories must be absolute.'
[[ ! -L $hs_root ]] || fail 'Backup directory must not be a symlink.'
mkdir -p "$hs_root"
[[ $(stat -c '%u:%a' "$hs_root") == 0:700 ]] || fail 'Backup directory must be root-owned, mode 0700.'
exec 9>"$hs_root/backup.lock"
flock -n 9 || fail 'Another Headscale backup operation is running.'

hs_capture=''
hs_container=''
hs_restart=0
cleanup() {
  local result=$?
  trap - EXIT
  if [[ $hs_restart == 1 ]]; then
    printf 'Restoring the original Headscale service after an interrupted capture.\n' >&2
    if ! timeout 45 docker start "$hs_container" >/dev/null; then
      printf 'Headscale restart failed; start the service from its Compose stack.\n' >&2
      result=1
    fi
  fi
  if [[ -n $hs_capture ]]; then rm -rf -- "$hs_capture"; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

if [[ ${1:-} == password && $# == 1 ]]; then
  [[ -t 0 ]] || fail 'Password entry requires an interactive terminal.'
  [[ ! -e $RESTIC_PASSWORD_FILE && ! -L $RESTIC_PASSWORD_FILE ]] || fail 'The password file already exists.'
  read -r -s -p 'New Headscale backup encryption password: ' hs_password
  printf '\n'
  read -r -s -p 'Repeat password: ' hs_confirmation
  printf '\n'
  [[ ${#hs_password} -ge 24 && $hs_password == "$hs_confirmation" ]] || fail 'Use at least 24 characters and matching entries.'
  (set -o noclobber; printf '%s' "$hs_password" > "$RESTIC_PASSWORD_FILE")
  unset hs_password hs_confirmation
  printf 'Saved the root-only encryption password file.\n'
  exit
fi

[[ -f $RESTIC_PASSWORD_FILE && ! -L $RESTIC_PASSWORD_FILE ]] || fail 'Run the password command first.'
[[ $(stat -c '%u:%a' "$RESTIC_PASSWORD_FILE") == 0:600 ]] || fail 'Password file must be root-owned, mode 0600.'
[[ -f $RCLONE_CONFIG ]] || fail 'The configured rclone file is missing.'
[[ $("$hs_restic" version) == 'restic 0.19.1 '* ]] || fail 'Expected restic 0.19.1.'
mkdir -p "$RESTIC_CACHE_DIR"
# Keep the lock in this shell only: rclone can briefly outlive restic after a
# command completes and must not block the next operation by inheriting fd 9.
restic_run() { timeout 30m "$hs_restic" --pack-size 8 "$@" 9>&-; }

case ${1:-} in
  init)
    [[ $# == 1 ]] || fail 'Usage: backup.sh init'
    # restic refuses to replace an existing repository.
    restic_run init
    ;;
  snapshots)
    [[ $# == 1 ]] || fail 'Usage: backup.sh snapshots'
    restic_run snapshots --host vault --tag headscale
    ;;
  retention)
    [[ $# == 1 ]] || fail 'Usage: backup.sh retention'
    restic_run forget --host vault --tag headscale --group-by host,tags \
      --keep-weekly 4 --keep-monthly 3 --dry-run
    ;;
  check)
    [[ $# == 1 ]] || fail 'Usage: backup.sh check'
    restic_run check --read-data
    ;;
  backup)
    [[ $# == 1 ]] || fail 'Usage: backup.sh backup'
    # Check credentials/repository before interrupting the service.
    restic_run cat config >/dev/null
    mapfile -t hs_containers < <(docker ps -a --filter "label=com.docker.compose.project=$hs_project" \
      --filter label=com.docker.compose.service=headscale --format '{{.ID}}')
    [[ ${#hs_containers[@]} == 1 ]] || fail 'Expected exactly one Headscale container in the selected Compose project.'
    hs_container=${hs_containers[0]}
    [[ $(docker inspect --format '{{.State.Running}}' "$hs_container") == true ]] || fail 'Headscale is intentionally stopped or unavailable; leaving it stopped.'
    docker inspect --format '{{json .Mounts}}' "$hs_container" |
      jq -e --arg config "$hs_source/config" --arg data "$hs_source/data" '
        any(.[]; .Type == "bind" and .Source == $config and .Destination == "/etc/headscale" and .RW == false) and
        any(.[]; .Type == "bind" and .Source == $data and .Destination == "/var/lib/headscale" and .RW == true)
      ' >/dev/null || fail 'Container mounts do not match the selected Headscale source.'
    for hs_file in config/config.yaml config/policy.json data/db.sqlite data/noise_private.key data/derp_server_private.key; do
      [[ -s $hs_source/$hs_file ]] || fail "Missing Headscale source: $hs_file"
    done
    [[ ! -e $hs_root/capture && ! -L $hs_root/capture ]] || fail 'A capture directory already exists; inspect the interrupted operation first.'
    mkdir "$hs_root/capture"
    hs_capture="$hs_root/capture"
    docker inspect --format '{{json .Config.Image}}' "$hs_container" |
      jq --arg at "$(date -u +%FT%TZ)" '{image:.,capturedAt:$at}' > "$hs_capture/metadata.json"
    hs_restart=1
    timeout 45 docker stop --time 30 "$hs_container" >/dev/null
    cp -a -- "$hs_source/config" "$hs_source/data" "$hs_capture/"
    timeout 45 docker start "$hs_container" >/dev/null
    hs_restart=0
    hs_ready=0
    for ((hs_attempt=0; hs_attempt<30; hs_attempt++)); do
      if timeout 2 docker exec "$hs_container" headscale health >/dev/null 2>&1; then hs_ready=1; break; fi
      sleep 1
    done
    [[ $hs_ready == 1 ]] || fail 'Headscale restarted but did not become healthy; backup was not accepted.'
    printf 'Headscale restarted and healthy; uploading the captured copy.\n'
    (
      cd "$hs_capture"
      [[ -z $(find config data -type l -print -quit) ]] || fail 'Headscale capture contains a symlink; inspect before accepting recovery.'
      find config data -type f -print0 | sort -z | xargs -0 sha256sum > checksums.sha256
      # Throttle only the captured JSON progress log. Applying this globally
      # suppresses short interactive snapshots/retention reports in restic 0.19.1.
      RESTIC_PROGRESS_FPS=0.016666 restic_run backup --json --tag headscale --host vault --read-concurrency 1 . > "$hs_root/last-backup.jsonl"
    )
    hs_snapshot=$(jq -r 'select(.message_type == "summary") | .snapshot_id' "$hs_root/last-backup.jsonl")
    [[ $hs_snapshot =~ ^[a-f0-9]{64}$ ]] || fail 'No full snapshot ID was returned by this backup.'
    restic_run check
    # Keep all copies until the owner completes the restore rehearsal and
    # explicitly enables retention with a root-only marker file.
    if [[ -f $hs_root/retention-enabled ]]; then
      restic_run forget --host vault --tag headscale --group-by host,tags \
        --keep-weekly 4 --keep-monthly 3 --prune
    fi
    jq -n --arg at "$(date -u +%FT%TZ)" --arg snapshot "$hs_snapshot" \
      '{completedAt:$at,snapshotId:$snapshot,repositoryCheck:"passed"}' > "$hs_root/last-success.json.tmp"
    mv "$hs_root/last-success.json.tmp" "$hs_root/last-success.json"
    printf 'Backup accepted: %s\n' "$hs_snapshot"
    ;;
  restore)
    [[ $# == 3 && $2 =~ ^[a-f0-9]{64}$ && $3 == /* ]] || fail 'Usage: backup.sh restore FULL_SNAPSHOT_ID NEW_ABSOLUTE_DIRECTORY'
    [[ ! -e $3 && ! -L $3 ]] || fail 'Restore destination must not already exist.'
    case $(realpath -m -- "$3")/ in
      "$(realpath -m -- "$hs_source")/"*) fail 'Restore destination must be outside the live Headscale directory.' ;;
    esac
    restic_run snapshots "$2" --json | jq -e 'length == 1 and .[0].hostname == "vault" and (.[0].tags | index("headscale")) != null' >/dev/null
    mkdir -m 700 -- "$3"
    restic_run restore "$2" --target "$3" --verify
    (cd "$3" && sha256sum --check --status checksums.sha256)
    jq -n --arg snapshot "$2" '{snapshotId:$snapshot,hashesVerified:true}' > "$3/.headscale-restore.json"
    printf 'Restored files match the captured hashes. Live Headscale was not changed.\n'
    ;;
  *) fail 'Usage: backup.sh password|init|backup|snapshots|retention|check|restore FULL_SNAPSHOT_ID NEW_ABSOLUTE_DIRECTORY' ;;
esac
