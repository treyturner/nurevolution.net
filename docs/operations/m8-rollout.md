# M8 production rollout

The owner authorized the phased production rollout on 2026-09-18. Retain automatic deployment recovery and establish a resource-compatible fallback before exposing new RSS references.

PR #56 merged as `4ca5c3d676824348eefaab585a8144300d0a7858`. It includes both chapter/artwork support and RSS advertisement. The earlier support-only commit `e1013e0` is an ancestor, but was never itself a main push and cannot satisfy the deployment bootstrap's provenance requirements. Do not weaken those checks or rewrite main history to publish it.

## Preparation

Temporarily restore the feed projection, serializer, and related checks from `e1013e0`, leaving the current player and all resource endpoints intact. Review and merge this preparation release, then allow main Verify to publish its exact tested artifact.

1. Deploy that support-only release through the existing production workflow.
2. Verify unchanged subscriber identities and no new item artwork/chapter references, all artwork bytes and headers, every timed chapter document, representative GET/HEAD/304 requests, and untimed 404s.
3. Retain its verified bundle on the host as the fallback. The bootstrap retains the current bundle before the next promotion; verify the resulting current/previous records and back them up.
4. Deploy the verified PR #56 merge artifact, which already contains the approved RSS advertisement. Verify every advertised resource and the unchanged subscriber identities.
5. Restore RSS advertisement on main, record the actual deployment evidence, and synchronize the workspace. A documentation-only difference between main and the deployed PR #56 artifact does not require rebuilding that release.

## Results

Pending. Production was healthy at `c54adaef5b3f1cc75bf24c1b22cb6e194ea21742` when this rollout began. No claim of physical podcast-client artwork/chapter acceptance is made by HTTP verification; that remains a separate M8 acceptance check.
