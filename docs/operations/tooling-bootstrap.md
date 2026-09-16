# Versioned deployment tooling

Release tooling includes its bundled dependencies. A dependency-only change can change `deploy.mjs` even when deployment source and the renderer fingerprint are unchanged. The host still checks the complete executable hash; the stable [bootstrap](../../deploy/bootstrap.py) installs and selects the matching verified tool before that check runs.

## Trust and promotion

The installed Python bootstrap uses only the standard library and never updates itself. The deployment workflow sends its short-lived, read-only `GITHUB_TOKEN` over SSH stdin. The token is used only against this repository's GitHub API, stays out of arguments and files, and is not forwarded to the signed artifact-storage redirect or the release executable. No permanent host GitHub credential or GitHub CLI installation is needed. Allow outbound trusted HTTPS to `api.github.com` and the artifact-storage URL returned by that API.

Before executing release code, the bootstrap independently checks:

- The verification run was a successful `push` to this repository's `main`, for the requested full commit and `.github/workflows/verify.yml`.
- Exactly one nonexpired `release-<commit>` artifact belongs to that run/repository/branch/commit.
- The downloaded ZIP matches GitHub's authenticated artifact SHA-256 digest.
- The bounded archive contains exactly the six expected files, with no duplicate names, paths, or symlinks; release identity and executable/configuration/manifest/renderer hashes agree.

It stages the original archive, API provenance receipt, and expanded files atomically in `/srv/nurevolution/tooling/releases/<commit>/`. Every reuse validates both the archive and the expanded files. The receipt is trusted local state created after GitHub verification, not a portable signature for arbitrary uploads. Keep this directory operator-owned, private, and outside any web root.

Before changing tools or app, promotion also retains the currently deployed release's verified bundle. An expired or unavailable prior artifact stops an initial migration; restore its previously verified cache from trusted backup, or arrange an explicitly reviewed migration. Do not fabricate a provenance receipt to bypass the check. Subsequent promotions can reuse retained bundles without fetching them again.

`tooling/active` selects one release directory by atomic symlink replacement. `tooling/deploy.mjs` and `tooling/renderer.sha256` point through that selector. Existing deployment checks still validate both the installed and executing tool. Each workflow attempt has its own `incoming/<run_id>-<run_attempt>` directory; failed attempts remain available for diagnosis. A handled deployment failure reselects the tool matching the authoritative current record. A pending deployment journal requires recovery instead of guessing which release is active.

The bootstrap, promotion, offline rollback, and backup share `tooling/deploy.lock`. The release tool still holds the existing site/edge locks during its transaction. Use the bootstrap for all three entry points; raw `node deploy.mjs` operations bypass tooling coordination. Existing backup tooling already excludes `**/deploy.lock`, including this additional lock.

## One-time installation on the existing host

This installation changes deployment entry points and the backup unit. It does **not** replace or restart the running app, shared edge, or Docker. Install it before dispatching the first deployment with the updated workflow. Merging still only verifies and publishes a release; production promotion remains manual.

Requirements: the existing Node installation, Python 3 (already included with Ubuntu 26.04), root access for the three installed files and systemd reload, and no running or queued deployment. The existing `/srv/nurevolution` ownership, production profile, marker, and secrets remain in place. The reviewed revision must contain this bootstrap and protocol-2 wrapper.

From the owner's root SSH session, set `BOOTSTRAP_REV` to the full reviewed commit SHA containing this change, then run this block. It saves the old files, pauses the timer during installation, refuses a running backup or unresolved deployment, and restores the timer's prior active state on exit. Stop on failure and inspect the saved files before retrying.

```bash
BOOTSTRAP_REV=REPLACE_WITH_REVIEWED_FULL_COMMIT_SHA
(
  set -euo pipefail
  test "$(id -u)" = 0
  [[ "$BOOTSTRAP_REV" =~ ^[a-f0-9]{40}$ ]]
  install_dir=$(mktemp -d /root/nurevolution-bootstrap.XXXXXX)
  for file in bootstrap.py nurevolution-deploy backup.service; do
    curl --fail --silent --show-error \
      "https://raw.githubusercontent.com/treyturner/nurevolution.net/$BOOTSTRAP_REV/deploy/$file" \
      --output "$install_dir/$file"
  done
  test "$(python3 "$install_dir/bootstrap.py" version)" = 'nurevolution-deploy 2'
  bash -n "$install_dir/nurevolution-deploy"

  timer_was_active=false
  if systemctl is-active --quiet nurevolution-backup.timer; then
    timer_was_active=true
  fi
  trap 'if $timer_was_active; then systemctl start nurevolution-backup.timer; fi' EXIT
  systemctl stop nurevolution-backup.timer
  test "$(systemctl show -p ActiveState --value nurevolution-backup.service)" = inactive
  for lock in /srv/nurevolution/tooling/deploy.lock /srv/nurevolution/state/deploy.lock /srv/edge/config/deploy.lock; do
    test ! -e "$lock"
  done
  test -z "$(find /srv/nurevolution/state -maxdepth 2 -name pending.json -print)"

  cp -a /usr/local/bin/nurevolution-deploy "$install_dir/nurevolution-deploy.before"
  cp -a /etc/systemd/system/nurevolution-backup.service "$install_dir/backup.service.before"
  if test -f /usr/local/lib/nurevolution/bootstrap.py; then
    cp -a /usr/local/lib/nurevolution/bootstrap.py "$install_dir/bootstrap.py.before"
  fi
  install -d -o root -g root -m 0755 /usr/local/lib/nurevolution
  install -o root -g root -m 0644 "$install_dir/bootstrap.py" /usr/local/lib/nurevolution/bootstrap.py
  install -o root -g root -m 0755 "$install_dir/nurevolution-deploy" /usr/local/bin/nurevolution-deploy
  install -o root -g root -m 0644 "$install_dir/backup.service" /etc/systemd/system/nurevolution-backup.service
  systemctl daemon-reload
  test "$(runuser -u nurevolution-deploy -- /usr/local/bin/nurevolution-deploy --version)" = 'nurevolution-deploy 2'
  printf 'Bootstrap installed; previous files saved in %s\n' "$install_dir"
)
```

The timer's enabled-on-boot setting is unchanged. The installed backup entry point can use the old regular helper before the first migration, provided its hash matches the current deployment record. After the first promotion it uses the verified cached release. The unit grants write access to `tooling/` for its lock and selector as well as the existing backup paths; memory, concurrency, credentials, and restic retention settings are unchanged.

If installation must be undone before the first promotion, restore the `.before` wrapper and service, reload systemd, and retain any saved bootstrap file. After versioned tools have been activated, keep the bootstrap and use its rollback procedure; reverting only the wrapper would leave the old workflow protocol and tool selection assumptions in conflict.

## Promotion, rollback, and recovery

Dispatch **Deploy verified release** on `main` with a successful main Verify run ID and its full commit SHA. The workflow checks protocol version before transmitting the temporary token. Check the accepted deployment record and run the ordinary post-content backup when required by the release. No additional secret or per-release manual executable installation is needed.

Use [the rollback runbook](rollback.md) for rollback and interrupted transactions. The command below requires no GitHub token or network access for tooling; existing image/media/HTTPS acceptance checks still apply:

```sh
python3 /usr/local/lib/nurevolution/bootstrap.py rollback
```

Do not prune `tooling/releases/` automatically. The original ZIP and provenance receipt must travel with the expanded files in backups/restores. They keep rollback tooling available after GitHub's 90-day artifact retention expires. Images and media must remain available separately. To check a restored cached bundle without selecting or executing it:

```sh
python3 /usr/local/lib/nurevolution/bootstrap.py check FULL_COMMIT_SHA
```

For an explicitly selected missing bundle still available on GitHub, `stage VERIFY_RUN_ID FULL_COMMIT_SHA` accepts an Actions-read token on stdin and only verifies/caches files. Supply the token through a protected stdin source; never put it in arguments or shell history. This command does not activate tools or deploy an app.

After interruption, inspect the bootstrap lock, site/edge locks, any `tooling/*.next` selector, and the deployment journal before removing anything. Save evidence, establish the actual app/route state, and recover the accepted release using its retained verified tooling. Reconcile `tooling/active` to that recovered record as part of recovery, then remove only proven stale locks/temporary selectors. Backups and promotions deliberately refuse an unresolved journal.
