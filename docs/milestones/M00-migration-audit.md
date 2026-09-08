# M0 — Migration inventory and compatibility contract

Status: **Completed locally on 2026-09-07; migration ready.** No production changes were made.

Plan date: 2026-09-07.

Roadmap: [M0 — Inventory and migration contract](../../ROADMAP.md#m0--inventory-and-migration-contract).

Project guidance: [BOOTSTRAP.md](../BOOTSTRAP.md). Companion plan: [M1 — Foundation and verification](M01-foundation-and-verification.md).

## Outcome and scope

Produce a reproducible account of every historical podcast episode, its original identifiers, metadata, tracklist, artwork, audio, and legacy URLs. This establishes the compatibility contract and source evidence needed by M2 and M3.

M0 supports R1-FEED, R1-PLAYER, R1-TRACKS, and R1-DOWNLOAD. It discovers and records migration requirements; M2 implements the canonical episode importer. M0 does not change production, generate the replacement feed, redesign the website, re-encode media, or provision hosting.

M0 is independent of M1. Its audit tooling must run without a Nuxt application or JavaScript dependency installation.

## Confirmed decisions and entry conditions

The owner selected **complete local sources upfront** on 2026-09-07 and subsequently supplied the locations below. The inputs are distributed across three sibling directories; they do not need to be combined, copied, or renamed into one source folder. This supersedes the earlier remote-access choice and single-folder assumption.

These sources are outside the replacement application's public repository. Their owner-supplied paths are documented here for handoff; the audit tooling must accept them through a source-location manifest rather than hard-code them. Treat the named source locations as read-only inputs, and do not scan unrelated sibling repositories. Do not copy raw database dumps, WordPress source archives, MP3s, or credentials into Git.

| Input                     | Supplied location                                         | Intake responsibility                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database                  | `/home/coder/dev/net.nurevolution.db/nurevolution_wp.sql` | Validate the dump contains the WordPress schema and data; inspect for artwork references and any actual binary image data.                                                           |
| WordPress code            | `/home/coder/dev/net.nurevolution`                        | Inspect installed plugins/themes and custom episode, tracklist, and feed code. The observed WordPress installation root is `/home/coder/dev/net.nurevolution/wp`.                    |
| Audio                     | `/home/coder/dev/net.nurevolution.podcast`                | Inventory the episode MP3s in place, retaining original filenames.                                                                                                                   |
| Artwork files             | `/home/coder/dev/net.nurevolution/wp/wp-content/uploads`  | This uploads directory contains files. Identify the actual episode/show artwork and preserve its directory relationships.                                                            |
| Possible database artwork | The SQL dump listed above                                 | The owner believes artwork may also, or alternatively, exist as binaries in the database. Verify this; do not assume that attachment metadata or image URLs contain the image bytes. |

During intake, create a private source-location manifest with `wordpressRoot`, `databaseDump`, `audioRoot`, and `artworkDirectories`, using the supplied paths. Retain each asset's source-root label and relative path so the inventory remains portable and paths from different roots cannot collide. Keep the original server layout; `wp-config.php` and production credentials are unnecessary.

Before auditing, confirm the WordPress tree, SQL dump, and audio directory are readable and validate their expected contents. All three supplied locations and the uploads directory were confirmed to exist during this plan update; that is not evidence of archive or dump completeness. Artwork storage and episode associations are audit questions: a missing standalone image must trigger investigation of uploads, database records, and relevant code, rather than prevent that investigation from starting. If required WordPress/database/audio inputs are unavailable, report the missing category and leave the audit unstarted. Unresolved episode artwork becomes a named migration discrepancy after investigation. Source availability does not block M1.

## Repository and production evidence

At this source-location update the replacement repository contains the roadmap, bootstrap, and M0/M1 plans, all untracked in a repository with no commits. There is no package manifest, application source code, CI configuration, or canonical verification command. The external WordPress tree is migration input, not the replacement application's code. Re-inspect this baseline before implementation and preserve newer work.

The owner supplied a listing of 55 MP3 files totaling 6,767,918,690 bytes. This is a reference count, not a verified migration inventory.

A read-only inspection of the [production feed](https://nurevolution.net/feed/podcast) on 2026-09-07 returned HTTP 200 with `application/rss+xml; charset=UTF-8` and found:

- 55 feed items, each with a GUID and enclosure.
- Every GUID explicitly marked `isPermaLink="false"`.
- Audio URLs using `podcast.nurevolution.net`.
- Sample episode page URLs under `/podcast/`.
- GUID examples referring to both ordinary WordPress posts and `one_page_portfolio` records.

For example, the Ruminate item used GUID `https://nurevolution.net/?post_type=one_page_portfolio&p=484`; Broken used `https://nurevolution.net/?p=337`. Preserve these as opaque identifiers. Do not substitute a new slug or treat a URL-shaped GUID as a permalink when its attribute says otherwise.

This inspection was not saved as a migration snapshot. Capture a new dated reference when M0 starts. The matching counts do not prove that the database, feed, and audio listing contain the same complete episode set. Do not assume that all podcast content has WordPress post type `post` or that the feed contains the tracklists.

## Deliverables and file responsibilities

| Location                            | Responsibility                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/migration/MIGRATION-AUDIT.md` | Findings, source-field mapping, reconciliation totals, compatibility rules, discrepancies, verification evidence, and M2/M3 handoff. |
| `docs/migration/inventory.json`     | Sanitized machine-readable episode and asset inventory with stable source references.                                                |
| `docs/migration/track-timings.json` | Owner-supplied split-FLAC duration evidence, derived starts, matching decisions, and withheld mismatches.                            |
| `docs/migration/legacy-urls.json`   | Observed episode URLs mapped to source episode identities, without choosing future canonical slugs.                                  |
| `docs/migration/fixtures/`          | Small sanitized examples of public content and representations needed to test later import/feed behavior.                            |
| `tools/migration/audit.py`          | Standard-library Python command for reference capture, repeatable reconciliation, and artifact validation.                           |
| `tools/migration/tests/`            | Focused standard-library tests for reusable audit logic and validation behavior.                                                     |
| Owner-supplied private workspace    | Raw SQL, WordPress code, media, database exports, frozen feed response, full source manifest, and local access details.              |

JSON is the audit interchange format. It does not decide the canonical episode authoring format for M2. Use Python 3.12 or newer with the standard library; the inspected environment has Python 3.14.4. No Python web framework or application package manager is needed.

## Ordered implementation steps

### 1. Record intake and source provenance

- [x] Re-inspect repository status, applicable instructions, existing scripts, and source availability.
- [x] Resolve the separately supplied WordPress, SQL, audio, and uploads paths through the source manifest. Resolve a separate private output root; reject output locations that would overwrite source files or put raw inputs in the repository. Do not use `/home/coder/dev` as a recursive source root.
- [x] Record source-root labels, relative paths, sizes, SHA-256 checksums, and capture/export timestamps. Hash file contents without changing them.
- [x] Record which database export and asset snapshot belong together. Document any known capture-time differences.
- [x] Keep additional private access details and full raw-source manifests outside public audit artifacts. Use source-root labels and relative paths there; the owner-supplied locations in this plan provide the local handoff mapping.

### 2. Freeze the production reference

- [x] Fetch `/feed/podcast`, preserving the response body and relevant HTTP headers privately.
- [x] Record the requested/final URL, retrieval time, status, content type, and body checksum.
- [x] Validate that the response is parseable RSS rather than an HTML error or access-challenge page.
- [x] Reuse that frozen snapshot during reconciliation. Refreshing it is an explicit capture operation, not a side effect of running the audit again.
- [x] If the live feed is unavailable, report the failure. A supplied historical feed snapshot must be labeled with its provenance and age; do not present it as a current production capture.

### 3. Inspect the database offline

- [x] Identify the dump's database vendor/major version from its header and syntax. If it cannot be identified reliably, stop the restore and request that fact instead of guessing.
- [x] Use a matching official database image, recording its exact tag and resolved image digest. Create an isolated disposable container without published ports, host sockets, or production credentials.
- [x] Restore only the local snapshot. Keep temporary database credentials local and out of logs; inspect only the task's container and data.
- [x] Discover table prefixes, relevant post types, publication statuses, options, post metadata, and plugin-specific tables.
- [x] Trace attachment metadata and image references to files under the supplied uploads tree. Inspect relevant columns and values for actual binary or encoded image payloads; record whether artwork is file-backed, database-backed, or both.
- [x] Include custom post types and historical/unpublished records in discovery; assign dispositions before deciding what belongs in the public archive.
- [x] Export the relevant database evidence privately in a repeatable form. Do not rely on a live WordPress instance for subsequent comparisons.

### 4. Trace metadata generation

- [x] Inspect supplied plugin/theme code to identify how GUIDs, enclosure fields, publication dates, artwork, tracklists, timestamps, and episode URLs are produced.
- [x] Document exact table/meta keys and transformations, including serialized values, HTML fragments, and timezone behavior where present.
- [x] Read code without booting WordPress, executing its plugins, or deserializing executable objects.
- [x] Distinguish source publication instants from recording dates and filesystem modification dates.
- [x] Preserve both sides of conflicting evidence. The captured feed defines observed subscriber-facing identity; database/code evidence explains records and fields absent from the feed. Do not silently replace a conflicting value.

### 5. Reconcile records and assets

- [x] Match database records, feed items, and local media using documented identifiers and references, not filename dates alone.
- [x] Assign each discovered podcast record a disposition: migrate, excluded with reason, or unresolved with issue reference.
- [x] Account for drafts, excluded service content, multipart recordings, duplicate records, orphan assets, and feed limits.
- [x] Record original GUID and permalink semantics, publication instant, enclosure URL/type/length, episode page URLs, artwork, descriptions, and tracklist sources.
- [x] Compare enclosure byte lengths with local file sizes; preserve source filenames and URL encoding evidence.
- [x] Resolve each episode/show artwork reference against uploads and database evidence. If image bytes exist only in the database, extract copies to the private audit output without changing the dump, record the source table/record/column and decoding method, and verify image type and checksum. Metadata or a URL alone is not a recovered image.
- [x] When artwork exists in both locations, compare image bytes/checksums and retain both provenances. Record thumbnails/derivatives and differing originals explicitly rather than silently choosing one; report artwork that cannot be recovered as a migration discrepancy.
- [x] Record absent tracklists and absent timestamps as valid optional data. Invalid supplied timestamps are discrepancies; do not invent replacements.
- [x] Determine the expected published episode count from the reconciled evidence and explain its relationship to the two observed counts of 55.
- [x] Record any existing traffic evidence useful for droplet sizing if it is supplied; historical analytics migration remains outside scope.

### 6. Produce the compatibility contract and handoff

- [x] Write public report/inventory/URL map from sanitized evidence. Include only material suitable for the public repository.
- [x] Provide representative fixtures for actual source variations, including custom post types and unusual filenames. Keep raw production captures private.
- [x] Record every unexplained identity, publication-date, audio, artwork, or tracklist discrepancy under a stable issue ID.
- [x] Explain how M2 should preserve observed identifiers and which records need identity investigation because they are absent from the frozen feed.
- [x] Remove only the disposable services and temporary database state created for this audit; retain the private source/reference evidence for M2 and cutover comparisons.

## Audit interfaces and reproducibility

The inventory uses an explicit format version and contains source snapshot identifiers, episodes, assets, and issues. Episode records retain source-record references, disposition, original feed identity/enclosure fields, publication evidence, artwork associations, tracklist availability/representation, and legacy URLs. File assets retain source-root label, relative path, byte length, and checksum. Artwork recovered from the database also retains its table/record/column provenance, decoding method, and verified image type; private extraction paths stay out of public artifacts. Issues retain ID, affected records, evidence, and whether they block migration.

The URL map targets source episode identities. New canonical routes and slugs are M2/M4 work. Private data about excluded drafts stays private; public reports may record aggregate dispositions without publishing draft content.

Expose these command responsibilities:

```text
python3 tools/migration/audit.py capture-feed --output-dir <private-reference-directory>
python3 tools/migration/audit.py derive-timestamps --inventory docs/migration/inventory.json --durations <ffprobe-duration-listing.csv> --output docs/migration/track-timings.json
python3 tools/migration/audit.py reconcile --sources <private-source-manifest.json> --reference-dir <private-reference-directory> --database-export <private-export> --track-timings docs/migration/track-timings.json --output-dir docs/migration
python3 tools/migration/audit.py check --inventory docs/migration/inventory.json --legacy-urls docs/migration/legacy-urls.json --track-timings docs/migration/track-timings.json
python3 -m unittest discover -s tools/migration/tests -p 'test_*.py'
```

These commands are planned interfaces; none exists yet. `--sources` accepts the manifest's distinct roots and SQL file; it must not require a shared parent directory or source relocation. Document the exact database restore/export commands after discovering the dump's engine and field mapping. Pass locations as properly quoted arguments and do not interpolate source filenames into executable shell text.

`reconcile` must not contact production or recapture inputs. Sort output deterministically and derive substantive fields from frozen evidence. Keep execution timestamps separate from data used for equivalence comparisons. A rerun against the same inputs must reproduce the substantive inventory and URL map.

`check` reads artifacts without rewriting them: exit 0 means valid artifacts with no migration blockers; exit 1 means malformed/inconsistent artifacts or an operational failure; exit 2 means valid artifacts with explicitly recorded migration blockers. Report counts and issue IDs rather than dumping source records.

## Tests and acceptance evidence

| Case                                                           | Expected result                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| WordPress tree, SQL dump, or audio directory absent/unreadable | Intake reports the category; a complete audit is not claimed.                                                                   |
| Inputs in separate sibling directories                         | Source manifest resolves only the supplied roots/file; no relocation or scan of unrelated repositories.                         |
| Artwork referenced through WordPress attachments               | Reference resolves to actual image bytes; metadata alone is not counted as a recovered asset.                                   |
| Artwork stored as database image bytes                         | Private extraction preserves record/column provenance and verifies decoded image type/checksum without modifying source inputs. |
| Artwork present as both a file and database payload            | Both provenances retained; identical bytes distinguished from derivatives or conflicting images.                                |
| Artwork absent from the expected uploads location              | Investigate database/code evidence; record an unrecoverable asset as a migration discrepancy after discovery.                   |
| Same frozen evidence reconciled twice                          | Identical substantive inventory and URL map.                                                                                    |
| URL-shaped GUID with `isPermaLink="false"`                     | String and attribute are preserved exactly.                                                                                     |
| Custom WordPress post type                                     | Included in discovery and assigned a disposition.                                                                               |
| Duplicate/ambiguous GUID, enclosure, or episode match          | Explicit issue with affected records; no silent deduplication.                                                                  |
| Missing local media or enclosure-size disagreement             | Blocking discrepancy referencing the episode and asset.                                                                         |
| Missing tracklist or timestamp                                 | Represented as absent, without a fabricated value.                                                                              |
| Supplied malformed timestamp or inconsistent date              | Evidence preserved and discrepancy reported.                                                                                    |
| Filenames containing spaces, quotes, ampersands, or Unicode    | Paths, hashes, and references remain correct.                                                                                   |
| Invalid URL-map target or asset reference                      | Artifact validation fails with an actionable record reference.                                                                  |
| Public-artifact review                                         | No credentials, raw SQL, additional private access details, private extraction paths, or unpublished content.                   |

Every discovered podcast record must have a disposition. Every frozen feed item must map to one episode or an explicit blocking issue. Every published episode must resolve to audio/artwork or have a named blocking discrepancy. Evidence counts, including exclusions and unresolved matches, must reconcile.

Run the audit's unit tests and artifact check, record exact commands and exit codes, and inspect the full report. If M1 exists, also run `pnpm verify`; otherwise record that the canonical application gate has not been created. Do not add a fake successful verification command to bridge that gap.

M0 may hand off a completed audit with content blockers if the evidence and blockers are fully documented. Label that outcome **audit complete; migration blocked**, not **migration ready**. Invalid artifacts or incomplete source investigation do not satisfy M0.

## Completion and handoff checklist

- [x] Source intake and private provenance manifest are complete.
- [x] A dated feed reference and repeatable database evidence are retained.
- [x] Every source episode and feed item is accounted for.
- [x] Inventory, compatibility contract, URL map, fixtures, and discrepancy register agree.
- [x] Tests/checks have recorded commands, results, and any expected blocker exit status.
- [x] Public artifacts have been reviewed separately from private evidence.
- [x] Temporary database resources created by M0 are removed or explicitly documented for handoff.
- [x] M2/M3 entry conditions and blockers are explicit; production remains unchanged.
- [x] Record implementation changes, decisions, test results, and unresolved issues in the report and roadmap.

Do not mark these items complete while merely writing this plan. No commits, pushes, production changes, or deletion of original source material are included in the milestone's default workflow.

## Completion evidence and handoff — 2026-09-07

M0 reconciled 55 published `one_page_portfolio` records, 55 frozen feed items, and 55 local MP3s. Every episode maps uniquely to one feed item, audio file, and verified artwork original. The audit found 832 ordered tracks across 50 episodes; five episodes legitimately have no tracklist. The owner-supplied split-FLAC listing provides 317 derived starts across 21 episodes. Album title, artist, track count, and numbered order drive matching; directory dates do not. All 55 feed GUIDs explicitly use `isPermaLink="false"`.

The supplied MariaDB 11.3.2 dump restored successfully into the matching `mariadb:11.3.2-jammy` image at digest `sha256:e101f9db31916a5d4d7d594dd0dd092fb23ab4f499f1d7a7425d1afd4162c4bc`. The disposable restore used no published ports and no network. Relevant database evidence, the frozen feed and headers, the source-location manifest, and the full checksum manifest remain in the private audit workspace. The container and its anonymous data volume were removed after export.

Artwork is attachment/file-backed. Every episode and both channel artwork references resolve under the supplied uploads snapshot; no episode-table binary column, data URL, or encoded image payload was found. The inventory links 16 generated derivatives to their source attachments and records two unrelated identical-byte upload groups without choosing between them.

Three non-blocking discrepancies remain. For `M0-ACF-SIZE-278` and `M0-ACF-SIZE-340`, the duplicate ACF byte-length value is three bytes short, while the local file, serialized podPress size, and frozen RSS enclosure length agree exactly. `M0-TRACK-TIMING-417` withholds timestamps for Praxis because its split tracks total 3,396.349388 seconds, 19.650612 seconds less than the recorded episode duration. M2 should use the proven local/podPress/feed byte length, preserve stale ACF evidence, and leave Praxis untimed until its alignment is resolved.

Verification evidence:

- `python3 -m unittest discover -s tools/migration/tests -p 'test_*.py'` passed 12 tests.
- `python3 tools/migration/audit.py check --inventory docs/migration/inventory.json --legacy-urls docs/migration/legacy-urls.json --track-timings docs/migration/track-timings.json` exited 0 with 55 episodes, 156 assets, three non-blocking issues, and no migration blockers.
- A second reconciliation including the timing evidence left all substantive hashes unchanged: inventory `06b0de23c9a22959acf721c9fc9be82e49691a89ab8cc355fc808b7567aa42fe`, URL map `0faa24917ba86aa6bbb76fee19698be2da2f05a208b0b47dfb269352f14fe49f`, and track timings `dd787d166708f4c5b727089a2c6f35aee5b113b7bfac40e907a1cc5f1a7aaed7`.
- After timing enrichment, all verification gates passed locally: formatting, lint, type checks, 12 migration tests and artifact/timing validation, 14 Vitest tests at 100% statements/branches/functions/lines, both production builds, and 18 Playwright checks across Chromium, Firefox, and WebKit. They were invoked individually through Corepack because the shell did not expose the `pnpm` shim to the wrapper script. A remote GitHub Actions run was not triggered.
- A separate public-artifact scan found no absolute source paths, database credentials, raw SQL, private extraction paths, or unpublished content.

See [the migration audit](../migration/MIGRATION-AUDIT.md), [machine-readable inventory](../migration/inventory.json), [track timing evidence](../migration/track-timings.json), [legacy URL map](../migration/legacy-urls.json), and [representative fixtures](../migration/fixtures/representative-episodes.json). M2 and M3 may proceed with no migration blockers.
