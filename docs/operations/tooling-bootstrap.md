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

## Host installation

Follow the [Node runtime and bootstrap installation](node-runtime.md) to provision mise-managed Node 24 and install the protocol-3 entry point. The bootstrap never updates itself; an existing protocol-2 host must complete that operator migration before promoting a new release. The deployment workflow rejects the old protocol.

The runtime configuration is root-owned alongside the bootstrap. Promotion, backup, and rollback verify the configured executable/version before changing tooling; staging and cached-bundle inspection need only Python. The bootstrap executes Node directly, without shell activation, automatic installation, or a PATH fallback. The existing backup unit retains its systemd write restrictions and can execute both the previous helper and the new Node 24 bundle. Test an ordinary backup before merging/promoting, then again after promotion.

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
