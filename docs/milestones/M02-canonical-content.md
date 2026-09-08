# M2 — Canonical content and complete archive

Status: **Ready for implementation**. This document and its Praxis evidence record are plans and inputs; no canonical archive or M2 application code has been implemented.

Plan date: 2026-09-08. Roadmap: [M2](../../ROADMAP.md#m2--canonical-content-and-complete-archive). Prerequisites: [M0 audit](../migration/MIGRATION-AUDIT.md) and [M1 foundation](M01-foundation-and-verification.md). Project guidance: [BOOTSTRAP.md](../BOOTSTRAP.md).

## Outcome and boundaries

Create the complete, validated repository archive and a repeatable WordPress importer. The website and replacement RSS must consume one content model and one public-selection rule. M2 supplies the data prerequisite for R1-FEED, R1-PLAYER, R1-TRACKS, R1-DOWNLOAD, and R1-SUBSCRIBE.

Include schemas, canonical JSON, import/reconciliation reports, media references, description normalization, read-only content APIs, and contributor instructions. Implement the data layer without changing the minimal home page into the M4 player. Episode pages and redirects belong to M4; RSS serialization belongs to M3. Media copying, transcoding, deployment, full-file decode checks, and production delivery remain later work. Draft authoring and scheduled publishing are not M2 features; basic filtering must nevertheless prevent unpublished content from escaping.

The owner considers M0 sufficient for planning. Do not reopen archive-wide investigation, clean up WordPress, or repair its stale metadata. Use the frozen public audit inputs plus the narrowly verified Praxis correction below. Preserve original files and all existing uncommitted work. No commit, push, branch creation, or deployment is included.

## Entry evidence and baseline

Inspected on 2026-09-08:

- The checkout has no commits. M0/M1 files are untracked and must be preserved. There is no `content/`, content schema, content API, or M2 importer yet.
- `app/` contains the SSR shell and injected audio adapter. `server/` and `shared/` are available for the new boundaries. `tools/migration/audit.py` and its Python tests own M0 reconciliation; do not replace them with a second raw-SQL importer.
- M0 contains 55 published episodes, 55 unique MP3 references, 55 associated episode artwork originals, 55 observed legacy page URLs, and 156 inventoried assets. Exactly 112 distinct assets are directly referenced by the episodes and the two show-artwork fields; remaining assets are retained as provenance, not attached to unrelated episodes.
- There are 832 ordered tracks across 50 episodes; five have no tracklist. Frozen M0 supplies 317 starts across 21 episodes. The Praxis correction adds 21 starts, giving the M2 target **338 starts across 22 episodes** without changing the track count.
- All 55 feed GUIDs have `isPermaLink=false`. Thirteen database GUID representations contain `&#038;` where the parsed feed GUID contains `&`. Database UTC and feed publication instants agree for every episode; there are no publication ties in this snapshot.
- Newest: `wp-484`, Ruminate, `2020-05-09T06:02:57.000Z`. Oldest: `wp-337`, Broken, `2001-08-01T18:00:21.000Z`. The Mega 93.3 FM parts are separate episodes `wp-342` and `wp-344`.
- All descriptions and durations are present. Full source descriptions are short (maximum 625 characters), while RSS summaries are truncated. Full feed content retains paragraphs, two ordinary links, one WordPress-generated emoji image, and inline styling that should be removed.

The planning baseline **`pnpm verify` exited 0**, with `CI=1` and the declared pnpm shim on PATH. Results: 12 Python migration tests; the real artifact/timing check with 55 episodes, 156 assets, three non-blocking issues, and no blockers; 14 Vitest tests at 100% statements/lines/functions/branches; both Node builds; and 18 browser checks across Chromium, Firefox, and WebKit. A blocker message from the synthetic Python test is expected test output, not an archive blocker. Remote GitHub Actions has not run.

Frozen input hashes:

| Input                               | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `docs/migration/inventory.json`     | `06b0de23c9a22959acf721c9fc9be82e49691a89ab8cc355fc808b7567aa42fe` |
| `docs/migration/legacy-urls.json`   | `0faa24917ba86aa6bbb76fee19698be2da2f05a208b0b47dfb269352f14fe49f` |
| `docs/migration/track-timings.json` | `dd787d166708f4c5b727089a2c6f35aee5b113b7bfac40e907a1cc5f1a7aaed7` |

Record these and the supplemental evidence hash in the import report. New input hashes require an explicit new import review; ordinary checks never recapture the feed or read the private database/media directories.

### Praxis correction established during planning

The owner supplied a screenshot of all 21 Praxis splits. Its rounded durations total 3,397 seconds (56:37); each matches the previously recorded precise split duration rounded to the nearest second. The precise split total is 3,396.349388 seconds.

A read-only inspection of the supplied MP3 using Mutagen 1.48.1 reported **3,396.349387755102 seconds**, matching that precise total within 0.000001 second. Its SHA-256 matches the M0 asset: `03b4cb9a682b02711095cf7543b48a31a8f08e4155a4aa68b9632921c7e5f227`; byte length is 104,560,655. This supports treating the old 3,416-second duration as stale metadata, rather than a different split timeline. Mutagen reads MPEG stream information, including Xing headers; this is duration evidence, not a full decode or listening test. [Mutagen MP3 documentation](https://mutagen.readthedocs.io/en/latest/api/mp3.html)

The maintained [Praxis evidence record](evidence/M02-praxis-duration.json) captures the measurement, asset identity, source hashes, screenshot hash, and intended correction. During implementation:

1. Validate that the correction names `wp-417`, the exact M0 audio asset/hash, and the exact timing evidence. Reject a changed identity or mismatched evidence instead of applying a loose title match.
2. Set canonical `durationSeconds` to **3396.349388** and import the 21 precise `startTime` values already present in the withheld Praxis row of `track-timings.json`. The first is 0; the last is **3157.442948**. Do not accumulate the rounded screenshot values.
3. Record the exception to `M0-TRACK-TIMING-417` in the M2 report, preserving M0's original duration, disposition, and issue. Do not rewrite frozen M0 artifacts to erase their history.
4. Require complete positions 1–21, matching artist/title order, finite increasing starts, and all starts before the corrected duration. Keep all other withheld/unmatched timings absent.

No private MP3, screenshot file, Mutagen installation, or network access is required by the normal importer or CI: they use the checked evidence JSON. An optional future manual reproduction can inspect the hash-matched MP3 with the recorded reader version. Broader media integrity checks remain later release evidence.

## Planning decisions

These are concrete implementation choices based on inspected data; they are not additional owner requirements.

| Topic            | Decision and reason                                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring        | One UTF-8 JSON file per episode, named by immutable ID; separate show, assets, and legacy URL files. Current descriptions are short, JSON is already the audit format, and native parsing avoids a YAML/content-framework dependency. Use the existing Prettier format for maintained JSON. |
| Identity         | Retain `wp-<source ID>` for imported episodes. Keep the feed GUID independent of ID, filename, title, slug, or media URL. New hand-authored IDs may use another stable lowercase ASCII identifier.                                                                                          |
| Canonical route  | Reserve `/episodes/<slug>`. Derive initial slugs once from the final segment of each observed legacy page URL: decode once, NFKD-normalize, remove combining marks, lowercase, replace non-ASCII-alphanumeric runs with `-`, trim. Never regenerate a saved slug after title/artist edits.  |
| Slug collisions  | Reject empty candidates. For an initial collision, append `-<stable ID>` to each member of that collision group; reject any remaining collision. This snapshot has no candidate collisions. An established slug cannot be changed by a later import.                                        |
| Examples         | `wp-484` → `trey-turner-ruminate`; `wp-417` → `trey-turner-praxis`. Preserve the separate Mega parts and their distinct derived slugs. A canonical path is computed from a saved slug, not maintained in a second file.                                                                     |
| Publication      | Parse `publication.databaseUtc` explicitly as UTC and require agreement with `feedRfc822`; store ISO UTC with milliseconds. Preserve database-local/feed strings in M0 and link their provenance from the import report. No filename-date inference.                                        |
| Ordering         | Descending publication instant, then ascending stable ID using deterministic code-unit comparison. Never depend on directory enumeration or locale-specific collation.                                                                                                                      |
| Descriptions     | Import full `feedContentHtml`, normalize it under the policy below, and compare with source description evidence. Do not use the truncated RSS summary as the canonical description. Future UI/feed derive presentations from this one full description.                                    |
| Media            | Store exact enclosure URLs and audited hashes/lengths; preserve relative filenames and case. Retain current artwork URL paths. M2 copies no media binaries and provides no media proxy.                                                                                                     |
| Deferred cleanup | Keep stale ACF sizes as provenance; select the agreeing local/podPress/enclosure values. Retain unassociated artwork in the manifest without deduplication or reassignment.                                                                                                                 |

### Dependencies and execution

Retain M1's runtime, package-manager, framework, testing, and coverage versions. Add only these direct packages during implementation, with exact pins and a reviewed lockfile:

| Package                | Version | Scope and reason                                                                                                                              |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `zod`                  | 4.5.4   | Runtime schema validation with inferred TypeScript types; already present transitively, but application imports need a direct declaration.    |
| `sanitize-html`        | 2.17.7  | Server/tooling HTML parsing and sanitization without a browser DOM. Its declared Node minimum is 22.12.0, compatible with the pinned runtime. |
| `@types/sanitize-html` | 2.16.1  | Development types for the sanitizer; verify the used options during type checking.                                                            |

Metadata was checked on 2026-09-08. [Zod metadata](https://registry.npmjs.org/zod/4.5.4), [sanitizer metadata](https://registry.npmjs.org/sanitize-html/2.17.7), [sanitizer type metadata](https://registry.npmjs.org/@types%2Fsanitize-html/2.16.1). Recheck compatibility at installation and document any necessary smallest correction; do not bypass strict peers or approve unrelated build scripts.

Use the pinned Node 22 runtime's built-in TypeScript stripping for the small content CLIs: explicit relative `.ts` imports, `import type`, and erasable TypeScript only. Give CLI/shared imports their own strict Node-oriented type-check configuration; do not rely on Node to type-check or resolve Nuxt aliases. A separate TS executor is unnecessary for these constraints. [Node 22.23.2 TypeScript support](https://nodejs.org/download/release/v22.23.2/docs/api/typescript.html)

No Nuxt Content, CMS, database, YAML parser, Markdown renderer, image library, or player dependency is needed here. The M0 Python command and tests remain intact.

## Canonical contracts

Use strict schemas for maintained content: unknown keys are errors, not silently discarded fields. Parse file contents as `unknown`; avoid casts that substitute for validation. Source-audit parsing may allow unconsumed evidence fields, but must validate every field used, the source version, input hashes, and correction references. Derive domain/public types from schemas or explicit projections rather than duplicating validation interfaces. [Zod schema APIs](https://zod.dev/api)

### Files and fields

| File / record                   | Required shape and invariants                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content/show.json`             | `schemaVersion: 1`, stable `id`, `title`, `descriptionText`, `siteUrl`, `feedUrl`, `standardArtworkAssetId`, `itunesArtworkAssetId`. Preserve `nurevolution studios`, the observed description, site link, and `/feed/podcast`. Both image IDs must resolve to artwork assets. M3 may add further verified channel fields; do not invent owner/contact/category metadata.                     |
| `content/episodes/<id>.json`    | `schemaVersion: 1`, `id`, `slug`, `status`, `publishedAt`, `title`, `artist`, `descriptionHtml`, `guid`, `guidIsPermalink`, `audioAssetId`, `artworkAssetId`, `durationSeconds`, `tracks`. File basename must equal `id`. Imported IDs/slugs/GUIDs are unique; all 55 historical records are `published`.                                                                                     |
| Publication state               | `status` is `published` or `draft`; reject unknown states. Published records require a valid instant; drafts may have `publishedAt: null`. The M2 authoring check rejects a future-dated published record with an instruction to keep it draft. Scheduling support comes in M8.                                                                                                               |
| Episode values                  | Title/artist must contain non-whitespace text without HTML markup or control characters. `guid` is a nonempty opaque string and `guidIsPermalink` is a boolean, never a string coercion. Do not trim, URL-normalize, decode, or otherwise rewrite historical GUID values. `durationSeconds` is finite and positive or `null` if genuinely unavailable; every imported episode has a duration. |
| Track                           | `position` is an integer starting at 1 with no gaps; `artist` and `title` are nonempty display strings; `startTime` is finite numeric seconds or `null`. Preserve source order and original text. Accept missing tracklists as `tracks: []`, not a fabricated row. All M2 imports retain the 832 source rows.                                                                                 |
| Timing                          | Zero is a valid start. Known starts must strictly increase in display order, including across untimed rows, and be less than a known duration. Reject negative, nonfinite, duplicate, decreasing, or out-of-range starts; do not sort, clamp, invent, or drop tracks to pass validation. Retain six-decimal source precision. Partial timing is valid.                                        |
| `content/assets.json`           | Versioned list of all 156 assets: `id`, `kind` (`audio`/`artwork`), `url`, `mediaType`, positive safe-integer `byteLength`, lowercase SHA-256, and provenance `sourceRoot`/`relativePath`. Asset IDs are unique; referenced kind must match the consuming field. Same-byte artwork files remain distinct records.                                                                             |
| `content/legacy-urls.json`      | Versioned map of each observed episode URL to its canonical episode ID. Exactly 55 mappings initially, with no ambiguous source URL or dangling target. Targets remain IDs so routing can derive paths from saved slugs in M4.                                                                                                                                                                |
| `content/wordpress-import.json` | Versioned deterministic import report: source/correction hashes, importer version, expected/actual counts, source-to-ID/slug/file/asset mappings, selected metadata sources, timing provenance by episode/position, description transformations, issue dispositions, and initial output fingerprints. This is provenance, not a second editable archive.                                      |

For canonical optional fields use `null` consistently; do not turn invalid nonempty values into absence. Validate cross-record uniqueness, ID references, required artwork, and URL maps after validating individual records. Reject duplicate IDs, slugs, feed GUIDs, and published audio enclosure URLs. Do not require artwork URLs or hashes to be unique across different asset records.

### Normalization and source preservation

- Copy `originalIdentity.feedGuid` and `feedGuidIsPermalink` literally. Keep the original database representation in frozen evidence; e.g. `wp-417` uses `&p=417` in the canonical GUID and preserves the `&#038;p=417` source representation through its evidence reference. HTML decoding is not a GUID operation. M3 escapes XML at serialization time.
- Convert only recognized `MM:SS` or `H:MM:SS` duration forms, validating component bounds. Compare feed/database durations semantically. Apply the Praxis correction explicitly, not through a global preference or permissive mismatch rule.
- For `wp-278`, select 117,345,591 bytes; for `wp-340`, select 44,030,050 bytes. Verify each equals the referenced local asset, podPress, and enclosure evidence. Stale ACF values do not override these values.
- Copy audio URLs exactly from `enclosure.url`, including apostrophe/ampersand percent-encoding. Parse URLs for validation but return the original string; never double-encode `%26` or decode it into an ambiguous URL. Permit absolute HTTP/HTTPS without credentials; reject other schemes, fragments on media URLs, or invalid escape sequences.
- Construct artwork URLs from the audited uploads URL base `https://nurevolution.net/wp/wp-content/uploads/` and percent-encode individual raw relative-path segments. First prove this rule reproduces both observed show-artwork URLs. This defines intended legacy paths, not a live reachability claim; M5 must serve/check those paths after cutover.
- Use `audio/mpeg` for the audited MP3s and M0's `verifiedMediaType` for artwork. Do not infer image dimensions that the audit does not contain. Reject absolute/traversing provenance paths and path separators injected through IDs or slugs.
- Keep all original publication, description, identity, and source-file evidence in M0. Link to it by snapshot/episode ID and hashes in the M2 report. Do not bundle the SQL dump, raw exports, attachment filesystem paths, or frozen raw feed into the application.

### Description policy

Use full feed content because it preserves the source paragraphs, links, and WordPress text formatting. Do not reconstruct descriptions from filenames or truncated excerpts. Empty full feed content in new source evidence requires an explicit fallback to the full database description and a recorded conversion; an unexplained semantic difference is an import error requiring review.

Allow only `p`, `br`, `a`, `strong`, `em`, `ul`, `ol`, `li`, and `blockquote`, and only `href`/`title` on links. Preserve the two observed HTTP/HTTPS links and their text. Drop styling, classes, handlers, embedded players, scripts, iframes, SVG, and arbitrary images. For the known WordPress `wp-smiley` image in `wp-269`, preserve its emoji as escaped text from `alt`, then remove the image; do not retain its remote request or drop the emoji. Require an explicit importer transformation record for any meaningful removal beyond these observed changes. Future unsafe authored HTML fails with a field-specific diagnostic; it is not silently accepted as safe content.

Implement sanitization through the parser, not regular expressions. Use explicit tag/attribute/scheme options and disable protocol-relative links. Store normalized safe HTML; validation must reject noncanonical/unsafe HTML and report the normalized candidate without rewriting the file. Make normalization idempotent. Plain title/artist/track strings remain text and are escaped only by Vue/XML rendering. Do not repeatedly entity-decode sanitized output. [Sanitizer options and transforms](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html)

## Import and reconciliation workflow

The importer consumes public M0 JSON and the supplemental Praxis evidence, not WordPress, SQL, a running database, or live URLs. Its pure transformation produces a complete proposed catalog and deterministic report before the filesystem layer writes anything.

| Invocation / situation                           | Required behavior                                                                                                                                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm import:wordpress`                          | Dry-run against `content/`; report files to create, identical existing files, differences, and counts. Make no writes.                                                                                                |
| `pnpm import:wordpress --write --output content` | After full input and output validation, create missing planned files. Existing identical files stay byte-identical.                                                                                                   |
| Changed existing generated/author file           | Report the filename/field conflict and exit 2 before writing any destination files. This includes changed source metadata and hand edits. Do not overwrite even an apparently unedited older import automatically.    |
| `pnpm import:wordpress --check --output content` | Check agreement with the generated candidate; return 0 only for agreement, 2 for differences, 1 for malformed input/I/O errors. It never writes.                                                                      |
| Reviewed reconciliation                          | Generate a fresh candidate into a new `.local/` directory, review its diff, and manually merge intentional changes. No `--force`, automatic conflict resolution, or deletion of hand-authored episodes is part of M2. |
| Repeated import                                  | Same inputs produce the same bytes, order, source hashes, and report. Do not include wall-clock timestamps, absolute paths, nondeterministic IDs, or directory-enumeration order.                                     |

Use an explicit output root and validate every planned relative filename. Refuse an output overlapping the audit input directory. Stage the complete result, detect all conflicts before applying, and use exclusive file creation so a concurrent writer cannot be overwritten. On an I/O failure, report failure and remove only temporary/new files owned by this run; preserve pre-existing files. Unknown files and valid new hand-authored episodes are not importer-owned and must not be removed.

`--check` is an import reconciliation tool, **not** a permanent byte-for-byte authoring gate: legitimate later description/title/track corrections may differ from the original candidate. `check:content` validates the current authoring files and the protected historical identity/publication/enclosure contract, while import tests prove complete faithful transformation. The initial M2 acceptance comparison must account for all 55 episodes, 832 tracks, 338 starts, descriptions, and asset references; later intentional editorial corrections require ordinary review, not automatic reimport.

Protected historical fields are ID, saved slug, GUID/permalink semantics, original publication instant, enclosure URL/type/length, and audio asset identity/hash. Changes require a separately documented migration decision, not an editor silently changing subscriber identity. The known Praxis duration/timing correction is explicitly allowed by its evidence. Future new episodes are allowed by schema; do not hard-code a permanent total of 55 into runtime selection.

## Runtime boundary and public access

Keep domain types and pure ordering/filtering in `shared/content/`; put Node-only sanitization, complete validation, and storage adaptation in `server/content/`. The CLI may import pure/Node modules using explicit relative paths. App code imports public types only and must not import the raw content catalog.

Bundle `content/` as a named Nitro **server asset** directory (`baseName: 'content'`) using the installed Nitro 2.13.4 API. Read it through `useStorage('assets:content')` in a thin server adapter. Do not read the checkout relative to the production process's current directory or require a mutable database. Verify the installed v2 API rather than copying Nitro 3 import syntax. Server assets are bundled for runtime use and are distinct from public assets. [Nitro storage and server assets](https://nitro.build/docs/storage)

Use a small injected document-reader interface to run the same complete catalog validation against Node filesystem reads in the CLI and bundled assets in Nitro. Cache the validated raw catalog in production; development must see content edits without a stale process-wide cache. Validation failure must surface as a build/check error or server error, never a successful empty archive.

One pure selector accepts `(catalog, asOf)` and returns records with `status === 'published'` and `publishedAt <= asOf`, in the deterministic order above. Lookup and list operations both use it; drafts, future entries, and unknown slugs get no public record. Inject time in tests. This defensive rule does not promise scheduling: M2 rejects future-dated published authoring, and M8 owns scheduling/cache behavior.

Expose these read-only endpoints, with explicit allowlisted DTO construction rather than spreading raw records:

| Surface                    | Contract                                                                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/show`            | Public show metadata, feed/site URLs, and resolved show-artwork URLs.                                                                                                                                                                                                                            |
| `GET /api/episodes`        | `{ episodes: [...] }` of summaries: ID, slug, canonical path, title, artist, publication instant, duration, and artwork URL. No tracklists or audio preloading.                                                                                                                                  |
| `GET /api/episodes/<slug>` | One public episode: summary fields plus normalized description, GUID/permalink semantics, resolved audio URL/type/byte length/download filename, and ordered tracks. Valid but unknown or unpublished slugs return the same HTTP 404. Never concatenate a requested slug into a filesystem path. |
| Future M3 server consumer  | Calls the same repository/selector for full public records and show metadata. It does not maintain another sorted feed archive or fetch its own HTTP API.                                                                                                                                        |

Do not expose source-root paths, database representations, import reports, hashes of private snapshots, or unused manifest entries in API responses/hydration. JSON source and draft files must remain absent from `.output/public` and client bundles. The repository itself is public, so these boundaries are not a claim of confidential draft storage. M2 adds no RSS route, episode page, redirect, or player UI.

## File responsibilities and ordered implementation

| Target                                                                                            | Responsibility                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/content/schema.ts`, `shared/content/public.ts`                                            | Strict authoring schemas/types; pure public selection, ordering, and DTO types/projections.                                                                                                          |
| `server/content/description.ts`, `server/content/validate.ts`                                     | Safe description normalization and complete catalog/cross-record validation, usable by the CLI without Nuxt globals.                                                                                 |
| `server/content/repository.ts`, `server/utils/content.ts`                                         | Injected document reading, validated catalog loading, and thin Nitro server-assets binding.                                                                                                          |
| `server/api/show.get.ts`, `server/api/episodes/index.get.ts`, `server/api/episodes/[slug].get.ts` | Thin GET handlers using the same repository and explicit public projections.                                                                                                                         |
| `tools/content/source.ts`, `tools/content/import-wordpress.ts`, `tools/content/check.ts`          | Parse audited inputs/correction, pure import mapping plus explicit CLI entry, guarded filesystem writes, read-only content check. Split helpers further only when needed for clear responsibilities. |
| `content/`                                                                                        | 55 initial episode JSON files, show/assets/legacy map, and deterministic WordPress import report.                                                                                                    |
| `test/unit/content/`                                                                              | Source transforms, schemas, corrections, sanitization, ordering/filtering, repository errors, and filesystem/CLI behavior in disposable directories.                                                 |
| `test/e2e/content.spec.ts`                                                                        | Built-server API, full inventory comparisons, 404/projection boundaries, and portable loading.                                                                                                       |
| `tsconfig.content-tools.json`, existing config/scripts                                            | Strict Node-compatible tool checks; extend coverage to new importer logic; include `check:content` in verification and standalone builds.                                                            |
| `docs/CONTENT.md`, `README.md`, `ROADMAP.md`                                                      | Owner authoring instructions, import/validation commands, report evidence, and milestone handoff.                                                                                                    |

Implementation order:

1. [ ] Reinspect the checkout, preserve newer work, run `pnpm verify`, validate all four audited/supplemental input identities, and confirm the exact dependencies before installation.
2. [ ] Add strict schemas, canonical data types, timestamp/duration rules, safe HTML normalization, and pure public selection. Cover invalid/partial cases before connecting filesystem or framework code.
3. [ ] Implement source mapping and the explicit Praxis correction. Generate candidates in `.local/` and review all normalization decisions, especially emoji/links, GUID entities, multipart records, dates, and media encodings.
4. [ ] Add dry-run/check/create-only import modes with temporary-directory tests. Prove two clean outputs are byte-identical and an edited destination remains untouched on conflict.
5. [ ] Create the initial canonical files through the importer. Validate and reconcile 55 episodes, 832 tracks, 338 starts in 22 episodes, 156 assets, both show images, and 55 legacy URLs. Review the report before treating the archive as imported.
6. [ ] Add the shared catalog repository, Nitro server-asset packaging, and public APIs. Keep the M1 home page and audio adapter behavior unchanged.
7. [ ] Integrate content checks, importer coverage/type checks, API tests, and a portable production-output check into the existing gate. Retain all M0/M1 checks and all three browser engines.
8. [ ] Write authoring/reconciliation instructions, run the full final gate, and record actual implementation evidence and M3/M4 readiness in this plan and the roadmap.

## Verification contract

Preserve existing scripts and add:

| Command                 | Required effect                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm import:wordpress` | Planned dry-run CLI above; opt-in writes only. Not invoked by `verify`.                                                                                                                                    |
| `pnpm check:content`    | Read-only parse, schema, safe-description, reference, public-selection, and protected historical compatibility checks; named file/field diagnostics; nonzero for errors.                                   |
| `pnpm build`            | Run `check:content` before the normal Nuxt production build, so a standalone build cannot bypass content validation. Keep the media-fixture build independent.                                             |
| `pnpm typecheck`        | Retain Nuxt/test checks and additionally check content tools with strict Node module resolution and erasable syntax.                                                                                       |
| `pnpm test:coverage`    | Retain all app/shared/server patterns and add executable `tools/content/**/*.ts`, including unimported files. Exercise filesystem/error paths instead of excluding the importer.                           |
| `pnpm verify`           | Prepare → formatting → lint → types → migration tests → migration artifact/timing check → application/content coverage tests → build (including content check) → browser tests. Stop on the first failure. |

Keep 95% statements/lines/functions and 90% branches, with automatic threshold changes disabled. Node tool code must not fall outside typing or coverage merely because it is under `tools/`. Extend the existing Node Vitest project for content tests; Nuxt component tests continue using Nuxt-aware utilities. Reuse the existing Playwright process ownership and port overrides; do not add a test-only content endpoint to production.

Acceptance scenarios:

| Scenario                             | Required evidence                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete archive transformation      | Every `migrate` source maps once to the same ID; 55 outputs, including both Mega parts; 832 tracks retained in source order; five empty tracklists. Compare full input/output fields, not only counts or the small representative fixture.                                                                                                        |
| Timing enrichment                    | The existing 317 starts remain exact. Praxis adds 21 exact starts with duration 3396.349388 and a matching correction/asset hash. Reject a correction with another episode/hash, wrong track count, duplicate positions, or incompatible timing total.                                                                                            |
| Optional and malformed data          | Empty lists and partial `null` timing are accepted; wrong types, unknown keys/statuses, blank required text, duplicate identities/slugs/GUIDs, broken references, or inappropriate asset kinds fail with file/field diagnostics.                                                                                                                  |
| Time handling                        | UTC/feed agreement, invalid calendar dates, timezone-less authoring, ordering ties, leap-day cases, duration-component bounds, null duration, negative/nonfinite/duplicate/decreasing starts, and starts at/after duration are covered.                                                                                                           |
| Subscriber compatibility             | All 55 GUID strings/booleans, publication instants, and enclosure URL/type/length tuples match M0; the 13 database entity variants never become double-decoded/re-encoded identities. Praxis changes duration metadata only.                                                                                                                      |
| Descriptions                         | Preserve full text, paragraphs, both hyperlinks, and the `wp-269` emoji; remove known styling. Exercise encoded/obfuscated unsafe links, scripts, handlers, embedded media, malformed markup, literal ampersands, and idempotence. Test rejected authored HTML and reviewed import normalization separately.                                      |
| Asset/path handling                  | Preserve `%26`, `%27`, apostrophes, Unicode, case, and raw relative filenames; reject traversal and unsafe schemes. Verify source hashes/lengths as metadata without reading private media. Resolve all 112 currently referenced assets; retain the other 44 manifest entries without exposing them through the API.                              |
| Import reproducibility               | Two fresh output directories compare byte-for-byte, including reports. A rerun changes no bytes. Edited files or changed source inputs cause a conflict before any write; invalid input, output overlap, existing unknown files, and a raced destination are handled without overwriting user work.                                               |
| Later hand authoring                 | Valid new IDs/episodes and editorial corrections pass content validation without being overwritten by import. Protected historical identity changes fail. Import reconciliation differences remain distinguishable from malformed authoring.                                                                                                      |
| Public filtering                     | Injected time covers before/at/after publication; drafts and future entries are absent from both list and lookup; no mutation of input arrays. No permanent 55-item limit or implicit filesystem ordering.                                                                                                                                        |
| Actual built APIs                    | All three browser projects check JSON status/type, count/order, full detail completeness, unchanged encoded media URLs, and consistent 404s. Check projections for raw provenance keys and confirm `/content/...` cannot expose source files. Fetch every detail to reconcile all 832 tracks and 338 starts. No remote media requests are needed. |
| Portable output and failure behavior | Copy the built `.output` into a disposable directory and start its Node entry point from that directory with no content directory beside it; APIs must still resolve the archive. Check missing/malformed document-reader cases fail explicitly, not as an empty successful catalog. Stop only the processes started by the test.                 |
| Existing behavior                    | M1 SSR/keyboard/media-fixture isolation and real-audio checks still pass. M0 audit check remains unchanged and still reports its original three non-blocking issues.                                                                                                                                                                              |

Keep fixtures of malicious/malformed content in test directories, never in production content. Pure selector/projection tests cover unpublished synthetic records; built API tests exercise the real published archive. If a framework integration needs an unpublished fixture, use an isolated temporary build rather than shipping sentinel records.

Suggested implementation evidence commands, after the scripts exist:

```sh
pnpm import:wordpress --write --output .local/m2-import-a
pnpm import:wordpress --write --output .local/m2-import-b
diff -qr .local/m2-import-a .local/m2-import-b
pnpm import:wordpress --write --output content
pnpm import:wordpress --check --output content
pnpm check:content
pnpm verify
```

Use disposable copies for conflict/failure tests. Checks and builds must not alter maintained source, canonical files, or frozen audit artifacts. Confirm that by comparing their hashes around the final gate. Fresh installation/build must work with declared runtimes and public repository files alone. CI still invokes exactly the same `pnpm verify`; do not claim a remote run merely because its workflow exists.

## Completion and handoff

- [ ] Canonical schemas, authoring format, stable identity/slug policy, and description rules are implemented and documented.
- [ ] The complete initial archive and deterministic report reconcile to M0 plus the explicit Praxis correction, with no unexplained loss.
- [ ] Imports are reproducible and preserve existing edits; ordinary validation remains read-only.
- [ ] Both show images, all episode media/artwork, and legacy mappings resolve through the model without needing WordPress at runtime.
- [ ] Public lists/lookups share one predicate and stable order, return safe DTOs, and keep raw records out of client/public output.
- [ ] Strict tool typing, coverage thresholds, standalone content validation, production packaging, and all M0/M1 checks pass through `pnpm verify`.
- [ ] Record exact counts, source/output hashes, tests, coverage, build/API/browser results, and remote CI status. Keep planning-time evidence distinct from implementation-time evidence.
- [ ] `docs/CONTENT.md` explains edits, optional tracks/timing, adding episodes, safe HTML, media references, validation failures, and manual reconciliation. Draft/scheduling documentation points to M8 instead of promising it now.
- [ ] M3 receives verified identities, publication/enclosure metadata, show metadata, safe full descriptions, and public selection. M4 receives stable slugs, complete details, artwork/audio URLs, tracklists, and legacy mappings.

M2 makes no production changes. Its canonical metadata can be regenerated into a fresh candidate directory while the original archive and frozen evidence remain intact. Full MP3 decode/listening, remote range/download behavior, artwork delivery, feed-client validation, redirects, and cutover remain their assigned later milestones; this plan does not mark them complete.
