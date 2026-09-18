# M8 production rollout

The owner authorized the phased production rollout on 2026-09-18. Retain automatic deployment recovery and establish a resource-compatible fallback before exposing new RSS references.

PR #56 merged as `4ca5c3d676824348eefaab585a8144300d0a7858`. It includes both chapter/artwork support and RSS advertisement. The earlier support-only commit `e1013e0` is an ancestor, but was never itself a main push and cannot satisfy the deployment bootstrap's provenance requirements. Do not weaken those checks or rewrite main history to publish it.

## Preparation and release selection

PR #57 temporarily restored the feed projection, serializer, and related checks from `e1013e0`, leaving the current player and all resource endpoints intact. Automatic review and CI passed; the squash merge `4d0100c4cc5a0ee7122ad896db2dc2840f48e57b` received its own verified main artifact. The follow-up restores advertisement exactly as it appeared in the already-approved PR #56 merge.

1. Deploy that support-only release through the existing production workflow.
2. Verify unchanged subscriber identities and no new item artwork/chapter references, all artwork bytes and headers, every timed chapter document, representative GET/HEAD/304 requests, and untimed 404s.
3. Retain its verified bundle on the host as the fallback. The bootstrap retains the current bundle before the next promotion; verify the resulting current/previous records and back them up.
4. Deploy the verified PR #56 merge artifact, which already contains the approved RSS advertisement. Verify every advertised resource and the unchanged subscriber identities.
5. Restore RSS advertisement on main, record the actual deployment evidence, and synchronize the workspace. A documentation-only difference between main and the deployed PR #56 artifact does not require rebuilding that release.

## Results

Both phases completed on 2026-09-18, starting from healthy production release `c54adaef5b3f1cc75bf24c1b22cb6e194ea21742`.

| Phase             | Release                                    | Verification                                                                           | Deployment                                                                                      |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Resource support  | `4d0100c4cc5a0ee7122ad896db2dc2840f48e57b` | [Main Verify](https://github.com/treyturner/nurevolution.net/actions/runs/35397286533) | [Production promotion](https://github.com/treyturner/nurevolution.net/actions/runs/35398621964) |
| RSS advertisement | `4ca5c3d676824348eefaab585a8144300d0a7858` | [Main Verify](https://github.com/treyturner/nurevolution.net/actions/runs/35394870918) | [Production promotion](https://github.com/treyturner/nurevolution.net/actions/runs/35398872769) |

The first phase served all 55 verified artwork files and 34 exact chapter documents while leaving RSS byte-for-byte identical to the previous production feed. The second advertised 55 item images and 34 chapter references covering 626 known starts. Both retained all 55 GUID/enclosure/publication identities and both legacy feed aliases. All artwork GET/HEAD responses and hashes passed; all 21 untimed chapter routes returned non-cacheable 404s. Ruminate and Praxis passed fractional chapter data, old/current version hints, GET/HEAD, and conditional 304 checks.

Production's current record and active tooling select `4ca5c3d`; its previous record selects the compatible `4d0100c` support release. Both retained bundles passed the bootstrap's offline integrity/provenance check, and no recovery journal remains. The advertisement source commit is older in Git history because it is the already-verified PR #56 artifact; its application code matches the restored main code. No provenance rule was bypassed and neither image was rebuilt on the host.

The post-deployment backup completed at `2026-09-18T21:54:29.275Z`, snapshot `42c19efd169f29b1d4d2c57d1b6213f94bf314db593528f66d435dbc2e469f36`. The repository check passed, and an independent snapshot listing confirmed the current/previous records plus both full tooling bundles, including original artifact ZIPs and provenance receipts (18 required files). This was not a new full-data restore rehearsal.

The [structured evidence](../milestones/evidence/M08-production-rollout.json) records the live checks and post-deployment backup. Physical podcast-client artwork/chapter navigation and the remaining device checks are still pending; successful HTTP verification does not establish those outcomes or close M8.
