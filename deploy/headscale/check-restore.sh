#!/bin/bash
# Start only an isolated copy of an already verified restore. No network or ports.
set -Eeuo pipefail
umask 077
hs_source=${HS_SOURCE_ROOT:-/mnt/cache/appdata/headscale}
hs_image='ghcr.io/juanfont/headscale@sha256:0e7f1c6e4ce6c2a2a001103ecd3fa645a045adf30ac8a5234fe037b43000cd72'
fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ $EUID == 0 && $# == 1 && $1 == /* ]] || fail 'Usage as root: check-restore.sh ABSOLUTE_RESTORED_DIRECTORY'
hs_restore=$(realpath -e -- "$1")
case "$hs_restore/" in
  "$(realpath -m -- "$hs_source")/"*) fail 'Refusing the live Headscale directory.' ;;
esac
[[ -f $hs_restore/.headscale-restore.json ]] || fail 'Run backup.sh restore first.'
jq -e '.hashesVerified == true and (.snapshotId | test("^[a-f0-9]{64}$"))' "$hs_restore/.headscale-restore.json" >/dev/null
[[ $(jq -r .image "$hs_restore/metadata.json") == "$hs_image" ]] || fail 'Restore image differs from the reviewed Headscale 0.29.3 pin.'
[[ -z $(find "$hs_restore/config" "$hs_restore/data" -type l -print -quit) ]] || fail 'Refusing symlinks in restored configuration/data.'
(cd "$hs_restore" && sha256sum --check --status checksums.sha256)
hs_container=''
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n $hs_container ]]; then docker rm -f "$hs_container" >/dev/null || result=1; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
hs_container=$(docker create --network none --user 99:100 --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 256m --pids-limit 128 \
  --tmpfs /var/run/headscale:uid=99,gid=100,mode=0700,size=16m \
  --tmpfs /tmp:uid=99,gid=100,mode=0700,size=16m \
  "$hs_image" serve)
# Copy into the disposable container's own filesystem: no bind mounts, volumes,
# live paths, or external connectivity. The saved restore remains unchanged.
tar -C "$hs_restore" --transform='s,^config,etc/headscale,' \
  --transform='s,^data,var/lib/headscale,' -cf - config data |
  docker cp -a - "$hs_container:/"
docker start "$hs_container" >/dev/null
hs_ready=0
for ((hs_attempt=0; hs_attempt<30; hs_attempt++)); do
  if timeout 2 docker exec "$hs_container" headscale health >/dev/null 2>&1; then hs_ready=1; break; fi
  sleep 1
done
[[ $hs_ready == 1 ]] || fail 'Isolated restored server did not become healthy.'
# Do not print enrollment keys. Only a count of saved keys and public node facts.
hs_nodes=$(docker exec "$hs_container" headscale nodes list --output json |
  jq '(. // []) | map({id, name:(.given_name // .givenName // .name), addresses:(.ip_addresses // .ipAddresses), tags:(.forced_tags // .forcedTags // .tags)})')
hs_keys=$(docker exec "$hs_container" headscale preauthkeys list --output json | jq length)
hs_users=$(docker exec "$hs_container" headscale users list --output json | jq length)
docker stop --time 30 "$hs_container" >/dev/null
# Verify that startup retained each private server identity, without displaying it.
for hs_key in noise_private.key derp_server_private.key; do
  hs_expected=$(sha256sum "$hs_restore/data/$hs_key" | cut -d ' ' -f 1)
  hs_actual=$(docker cp "$hs_container:/var/lib/headscale/$hs_key" - | tar -xOf - | sha256sum | cut -d ' ' -f 1)
  [[ $hs_actual == "$hs_expected" ]] || fail 'Restored server replaced an identity key.'
done
(cd "$hs_restore" && sha256sum --check --status checksums.sha256)
jq -n --arg at "$(date -u +%FT%TZ)" --argjson nodes "$hs_nodes" --argjson keys "$hs_keys" --argjson users "$hs_users" \
  --slurpfile restored "$hs_restore/.headscale-restore.json" \
  '{at:$at,snapshotId:$restored[0].snapshotId,healthy:true,serverKeysPreserved:true,restoreFilesUnchanged:true,network:"none",nodes:$nodes,savedEnrollmentKeyCount:$keys,savedUserCount:$users}' |
  tee "$hs_restore/restore-check.json"
