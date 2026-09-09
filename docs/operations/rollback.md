# Rollback and interrupted deployment

The operator CLI retains `state/current.json`, `state/previous.json`, a durable `state/pending.json` while a change is underway, and `state/last-attempt.json`. Keep current/previous images locally and retrievable from GHCR, and retain their bundles independently. The rollback record includes app image identity, canonical manifest, Compose template, and configuration/profile hashes. No whole-droplet snapshot restore is part of an app rollback.

To revert an accepted release using the same checks and locks:

```sh
node /srv/nurevolution/tooling/deploy.mjs rollback \
  --root /srv/nurevolution --edge-directory /srv/edge/config \
  --edge-container RECORDED_EDGE_CONTAINER
```

This refuses a catalog downgrade that would withdraw published episodes or change GUID/enclosure identity. Install the matching verified renderer before switching if its fingerprint changed; reconcile a newer catalog into a compatible fallback when necessary. No command automatically prunes media, images, volumes, other sites, or the shared edge.

A failed health/HTTPS check restarts the prior app and restores the edge route. A failed first deployment leaves the app undeployed. Failed recovery retains the journal and reports candidate/prior identifiers. The transaction updates the current record only after acceptance; inspect the attempt record and actual containers rather than inferring success from an incoming bundle.

After a killed process or host interruption, the next deployment refuses an existing lock or journal. Confirm there is no active deployment, backup, or other edge change. Save the pending/current/previous records and current edge configuration. Inspect which image is actually running and whether the candidate route became active. Select the compatible known release, restore its exact app/route with the recorded profile, and repeat local/HTTPS/feed/media checks. Only then archive the interrupted journal and remove stale site/edge lock directories and owned `.pending` files. Do not remove a live lock or simply rerun through an unresolved journal.

Every shared-edge editor must honor `/srv/edge/config/deploy.lock`. Deployments preserve the other routes/settings and reload gracefully; unrestricted concurrent manual edits are outside the locking contract. Record the app interruption interval and prove an unrelated sentinel endpoint plus media remain available during ordinary app replacement.
