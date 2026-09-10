# Rollback and interrupted deployment

The operator CLI retains `current.json`, `previous.json`, a durable `pending.json` while a change is underway, and `last-attempt.json` beneath `state/preview/` or `state/production/`, selected by the host profile. The site-wide lock remains `state/deploy.lock`; an unresolved journal in either environment blocks both. Unscoped records from the prototype require explicit environment reconciliation before promotion. Keep current/previous images locally and retrievable from GHCR, and retain their bundles independently. The rollback record includes app image identity, canonical manifest, Compose template, the accepted host profile, and configuration/profile hashes. The profile hash covers its canonical JSON serialization. Missing, inconsistent, or cross-environment saved profiles stop promotion before Docker operations; reconcile prototype state against the actual accepted configuration before proceeding. No whole-droplet snapshot restore is part of an app rollback.

To revert an accepted release using the same checks and locks:

```sh
node /srv/nurevolution/tooling/deploy.mjs rollback \
  --root /srv/nurevolution --edge-directory /srv/edge/config \
  --edge-container RECORDED_EDGE_CONTAINER
```

This selects only the previous record for the profile's environment and refuses a catalog downgrade that would withdraw published episodes or change GUID/enclosure identity. Install the exact verified `deploy.mjs` for the target release before switching when its executable hash differs; reconcile a newer catalog into a compatible fallback when necessary. The host hashes both its installed tooling file and the executing bundle against the release configuration. No command automatically prunes media, images, volumes, other sites, or the shared edge.

A failed health/HTTPS/media check restarts the prior app for the same environment and restores the edge route. Acceptance includes a representative enclosure HEAD/range request, its download redirect and attachment metadata, and an artwork probe before committing state. A failed first deployment leaves the app undeployed. The first production deployment has no production fallback merely because preview was deployed; M6 must retire the preview app/route explicitly and prepare the production fallback/cutover sequence. Failed recovery retains the journal and reports candidate/prior identifiers. The transaction updates the current record only after acceptance; inspect the attempt record and actual containers rather than inferring success from an incoming bundle.

When `profile.json` changes website or media hostnames within an environment, candidate acceptance uses the new addresses and automatic recovery checks the addresses saved with the prior release. Keep the prior DNS/TLS paths reachable until the change is accepted. Automatic recovery leaves the proposed `profile.json` available for correction or retry; it does not replace the operator's file. An explicit rollback command deploys the selected earlier release using the current operator profile.

After a killed process or host interruption, the next deployment refuses an existing lock or journal. Confirm there is no active deployment, backup, or other edge change. Save the pending/current/previous records and current edge configuration. Inspect which image is actually running and whether the candidate route became active. Select the compatible known release, restore its exact app/route with the recorded profile, and repeat local/HTTPS/feed/media checks. Only then archive the interrupted journal and remove stale site/edge lock directories and owned `.pending` files. Do not remove a live lock or simply rerun through an unresolved journal.

Every shared-edge editor must honor `/srv/edge/config/deploy.lock`. Deployments preserve the other routes/settings and reload gracefully; unrestricted concurrent manual edits are outside the locking contract. Record the app interruption interval and prove an unrelated sentinel endpoint plus media remain available during ordinary app replacement.
