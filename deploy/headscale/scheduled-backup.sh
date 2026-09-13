#!/bin/bash
# Unraid User Scripts entry point; preserve LF line endings.
set -euo pipefail
umask 077
hs_root=${HS_BACKUP_ROOT:-/mnt/cache/appdata/headscale-backup}
hs_webhook="$hs_root/discord-webhook"
fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ $hs_root == /* && -d $hs_root && ! -L $hs_root ]] || fail 'Invalid backup directory.'
[[ $(stat -c '%u:%a' "$hs_root") == "$EUID:700" ]] || fail 'Backup directory must be private and owned by the operator.'
validate_url() { [[ $1 =~ ^https://discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9._-]+$ ]]; }
if [[ ${1:-} == configure && $# == 1 ]]; then
  [[ -t 0 ]] || fail 'Configure from an interactive terminal.'
  [[ ! -e $hs_webhook && ! -L $hs_webhook ]] || fail 'Webhook already exists.'
  read -r -s -p 'Discord webhook URL (hidden): ' hs_url
  printf '\n'
  validate_url "$hs_url" || fail 'Use the complete HTTPS Discord webhook URL.'
  (set -o noclobber; printf '%s\n' "$hs_url" > "$hs_webhook")
  unset hs_url
  printf 'Saved the private webhook. No message sent.\n'
  exit
fi
[[ $# == 0 ]] || fail 'Usage: scheduled-backup.sh [configure]'
[[ -f $hs_webhook && ! -L $hs_webhook ]] || fail 'Configure the Discord webhook before scheduling.'
[[ $(stat -c '%u:%a' "$hs_webhook") == "$EUID:600" ]] || fail 'Webhook must be a private file owned by the operator.'
hs_url=$(<"$hs_webhook")
validate_url "$hs_url" || fail 'Invalid saved Discord webhook.'
# Keep complete backup output in User Scripts, never in the notification.
if /bin/bash "$hs_root/backup.sh" backup; then exit 0; else hs_result=$?; fi
hs_payload=$(jq -nc '{content:"nurevolution Headscale backup FAILED on Unraid. Inspect backup_headscale in User Scripts, Headscale health, and the last successful Google Drive snapshot.",allowed_mentions:{parse:[]}}')
# Pass the credential through stdin, never a command argument. No redirects.
if hs_response=$(printf 'url = "%s?wait=true"\n' "$hs_url" |
  curl --config - --silent --fail --proto '=https' --connect-timeout 10 --max-time 25 \
    --request POST --header 'Content-Type: application/json' --data "$hs_payload" 2>/dev/null) &&
  jq -e 'type == "object" and (.id | type == "string" and test("^[0-9]{1,32}$"))' <<< "$hs_response" >/dev/null; then
  printf 'Discord confirmed the Headscale backup failure alert.\n' >&2
else
  printf 'Headscale backup failed AND Discord did not confirm the alert. Check the webhook configuration.\n' >&2
fi
unset hs_url hs_response
exit "$hs_result"
