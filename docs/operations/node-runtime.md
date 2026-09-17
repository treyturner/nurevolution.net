# Node 24 with mise

The web image and CI already use Node 24. This migration moves the separate host deployment/backup helper to Node 24 and makes the workspace honor the repository's `mise.toml`. It requires an operator installation before production promotion. A PR merge still only verifies and publishes images; **Deploy verified release** remains manual.

## Runtime contract

- mise installs Node into the site's root-owned `/opt/nurevolution/mise/data` directory. It does not change a user's global mise configuration or `/usr/local/bin/node`.
- `/usr/local/lib/nurevolution/node-runtime.json` records the exact Node version and absolute executable returned by mise. It contains no secrets and is root-owned, readable by the deployment operator. `/etc/nurevolution` stays private.
- The protocol-3 bootstrap checks that binary's version before promotion, backup, or rollback changes release state. It launches the resolved binary directly and puts its directory first in the child PATH. Missing or mismatched runtimes fail without falling back to another Node.
- mise manages installation and upgrades; automated operations do not invoke mise, install tools, load shell/project configuration, or write runtime caches. The backup unit's existing `ProtectSystem=strict` and write allowances remain sufficient.
- Node injection settings (`NODE_OPTIONS`, `NODE_PATH`) are removed from helper execution. The existing deployment and backup environment, including restic credentials, remains available. Python continues to use the host's standard library.

This direct executable approach also works offline and with root-owned runtime directories. See mise's [installation guide](https://mise.jdx.dev/installing-mise.html), [data directories](https://mise.jdx.dev/directories.html), and [where command](https://mise.jdx.dev/cli/where.html).

## 1. Prepare the reviewed revision on the host

Run these commands in a **root Bash SSH session on the production droplet**, using the full approved PR commit SHA. Do this before merging/promoting the change. No app, edge, Docker, or Coder restart is needed. Keep the existing Node 22 installation for recovery and any unrelated consumers.

Requirements: Linux x86-64, curl, Python 3, tar/xz, HTTPS access to GitHub and Node's distribution servers, and the existing `nurevolution-deploy` user. Ensure no deployment workflow is running or queued during installation. The site-specific mise CLI is pinned below to the tested release and its GitHub-published SHA-256; updates to that CLI are separate operator actions.

```bash
RUNTIME_REV=REPLACE_WITH_APPROVED_FULL_COMMIT_SHA
set -euo pipefail
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
[[ "$RUNTIME_REV" =~ ^[a-f0-9]{40}$ ]]
install_dir=$(mktemp -d /root/nurevolution-node24.XXXXXX)
for file in bootstrap.py nurevolution-deploy backup.service; do
  curl --fail --silent --show-error \
    "https://raw.githubusercontent.com/treyturner/nurevolution.net/$RUNTIME_REV/deploy/$file" \
    --output "$install_dir/$file"
done
curl --fail --silent --show-error \
  "https://raw.githubusercontent.com/treyturner/nurevolution.net/$RUNTIME_REV/.node-version" \
  --output "$install_dir/node-version"
node_version=$(cat "$install_dir/node-version")
[[ "$node_version" =~ ^24\.[0-9]+\.[0-9]+$ ]]
test "$(python3 "$install_dir/bootstrap.py" version)" = 'nurevolution-deploy 3'
bash -n "$install_dir/nurevolution-deploy"

curl --fail --location --silent --show-error \
  https://github.com/jdx/mise/releases/download/v2026.9.10/mise-v2026.9.10-linux-x64 \
  --output "$install_dir/mise"
printf '%s  %s\n' f917e52216924ef0a8b4eca3f7004dfcff3b94665716ac5685fd53006a491eee \
  "$install_dir/mise" | sha256sum --check
install -d -o root -g root -m 0755 /opt/nurevolution/mise/bin /opt/nurevolution/mise/data
install -o root -g root -m 0755 "$install_dir/mise" /opt/nurevolution/mise/bin/mise
mise_command=(env -i HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  MISE_DATA_DIR=/opt/nurevolution/mise/data MISE_CACHE_DIR="$install_dir/cache"
  MISE_STATE_DIR="$install_dir/state" /opt/nurevolution/mise/bin/mise
  --no-config --no-env --no-hooks)
"${mise_command[@]}" install "node@$node_version"
node_dir=$("${mise_command[@]}" where "node@$node_version")
[[ "$node_dir" == /opt/nurevolution/mise/data/installs/node/* ]]
test "$("$node_dir/bin/node" --version)" = "v$node_version"
chmod -R a+rX,go-w /opt/nurevolution/mise
test "$(runuser -u nurevolution-deploy -- "$node_dir/bin/node" --version)" = "v$node_version"
python3 - "$node_version" "$node_dir/bin/node" "$install_dir/node-runtime.json" <<'PY'
import json, pathlib, sys
pathlib.Path(sys.argv[3]).write_text(json.dumps({'version': sys.argv[1], 'executable': sys.argv[2]}) + '\n')
PY
printf 'Prepared runtime %s; installation files: %s\n' "$node_dir" "$install_dir"
```

Stop on any failure. Keep this shell and `install_dir` for the next step. Preparation installs Node alongside the old runtime and does not change the active deployment entry point.

## 2. Switch the bootstrap and verify the current release's backup

The block below pauses the backup timer, acquires the same lock as deployments/backups, and saves the existing files. The timer's previous active state is restored on exit; its enabled-on-boot setting is unchanged. The app continues serving throughout.

```bash
(
  set -euo pipefail
  timer_was_active=false
  lock_owned=false
  if systemctl is-active --quiet nurevolution-backup.timer; then timer_was_active=true; fi
  cleanup() {
    if $lock_owned; then rmdir /srv/nurevolution/tooling/deploy.lock; fi
    if $timer_was_active; then systemctl start nurevolution-backup.timer; fi
  }
  trap cleanup EXIT
  systemctl stop nurevolution-backup.timer
  test "$(systemctl show -p ActiveState --value nurevolution-backup.service)" = inactive
  mkdir /srv/nurevolution/tooling/deploy.lock
  lock_owned=true
  for lock in /srv/nurevolution/state/deploy.lock /srv/edge/config/deploy.lock; do
    test ! -e "$lock"
  done
  test -z "$(find /srv/nurevolution/state -maxdepth 2 -name pending.json -print)"

  install -d -o root -g root -m 0755 /usr/local/lib/nurevolution
  for file in bootstrap.py node-runtime.json; do
    if test -f "/usr/local/lib/nurevolution/$file"; then
      cp -a "/usr/local/lib/nurevolution/$file" "$install_dir/$file.before"
    fi
  done
  cp -a /usr/local/bin/nurevolution-deploy "$install_dir/nurevolution-deploy.before"
  cp -a /etc/systemd/system/nurevolution-backup.service "$install_dir/backup.service.before"
  for file in node-runtime.json bootstrap.py; do
    install -o root -g root -m 0644 "$install_dir/$file" "/usr/local/lib/nurevolution/$file.next"
    mv -f "/usr/local/lib/nurevolution/$file.next" "/usr/local/lib/nurevolution/$file"
  done
  install -o root -g root -m 0755 "$install_dir/nurevolution-deploy" /usr/local/bin/nurevolution-deploy
  install -o root -g root -m 0644 "$install_dir/backup.service" /etc/systemd/system/nurevolution-backup.service
  systemctl daemon-reload
  test "$(runuser -u nurevolution-deploy -- /usr/local/bin/nurevolution-deploy --version)" = 'nurevolution-deploy 3'
  runuser -u nurevolution-deploy -- python3 /usr/local/lib/nurevolution/bootstrap.py runtime
  python3 /usr/local/lib/nurevolution/bootstrap.py runtime
)

systemctl start nurevolution-backup.service
systemctl show -p Result -p ExecMainStatus nurevolution-backup.service
journalctl -u nurevolution-backup.service -n 25 --no-pager
cat /srv/nurevolution/state/backup.json
printf 'Saved installation files: %s\n' "$install_dir"
```

Both runtime checks must print the expected mise-managed executable; the backup must finish with `Result=success`, `ExecMainStatus=0`, and a new snapshot recorded in `/srv/nurevolution/state/backup.json`. Check that its `at` timestamp matches this backup and `repositoryCheck` is `passed`. This exercises the current release's existing helper under Node 24 and the real systemd sandbox before promotion. If the timer started that same backup first, wait for it to finish and inspect its result; do not force a concurrent backup or remove a live lock.

If installation or this backup fails, **do not merge or deploy**. Inspect the error. With no active backup/deployment, pause the timer and acquire `tooling/deploy.lock` as above, restore the saved `.before` bootstrap/wrapper/service and runtime configuration if one existed, then reload systemd and restore the timer state. On this first migration there is no previous runtime JSON; the restored protocol-2 bootstrap ignores the new file. Keep both Node installations and the saved files. A fresh host without a prior bootstrap needs its installation completed, not a protocol rollback.

## 3. Merge, verify, then promote

After host preparation and the backup pass:

1. Merge the approved PR. Wait for **Verify** on the resulting `main` commit to pass and publish its release artifact/images.
2. Dispatch **Deploy verified release** on `main`, supplying that successful Verify run ID and its full commit SHA.
3. Confirm the deployment succeeds and `/srv/nurevolution/state/production/current.json` records that commit. Check the site/player normally.
4. Start `nurevolution-backup.service` again and verify a successful new snapshot. This now exercises the new Node 24-targeted helper. Leave the backup timer enabled as before.

App rollback still uses `python3 /usr/local/lib/nurevolution/bootstrap.py rollback` and the retained verified tool. The Node 24 runtime stays installed for both the new and previous release helpers. Do not remove an installed runtime referenced by `node-runtime.json` or prune `/opt/nurevolution/mise/data` automatically.

## Workspace and future upgrades

In the workspace checkout, sync to the merged revision, run `mise install`, then `mise exec -- node --version`. It must print the repository pin. Existing shells with mise activation/shims pick up `mise.toml` in this repository; use `mise exec -- pnpm dev --host 0.0.0.0 --port 3000` to restart the dev server when convenient. The workspace image's global Node 22 can remain for other repositories; any template-level `mise exec node@22` command is outside this repository and must be updated separately if that tool should move to 24.

For future Node 24 patch updates, align `mise.toml`, `.node-version`, `package.json`, and the application image; preinstall the new host runtime and atomically update its root-owned JSON under the same operation lock before promotion. The Python bootstrap itself does not need a new version pin. Repeat the current-release backup test and retain the prior executable/configuration for recovery. A future major upgrade requires a reviewed bootstrap compatibility change as well as tests of retained rollback helpers.
