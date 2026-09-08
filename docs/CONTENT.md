# Editing the podcast archive

The canonical archive is in `content/`. It contains 55 historical episodes, 832 tracks, and 338 precise track starts across 22 episodes. All audio and artwork remain URL references; no historical media binaries are stored in this repository. The current page remains the M1 shell. M3 will generate RSS, and M4 will build episode pages and the player from this archive.

## Files you edit

| File                            | Purpose                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `content/episodes/<id>.json`    | One episode, with its description and ordered tracks. The filename must equal its immutable ID.     |
| `content/show.json`             | Show title, description, site/feed URLs, and the two artwork references.                            |
| `content/assets.json`           | Audio/artwork URL, media type, byte length, SHA-256, and original relative filename for each asset. |
| `content/legacy-urls.json`      | Observed historical page URLs mapped to stable episode IDs.                                         |
| `content/wordpress-import.json` | Generated initial-import evidence. Keep it unchanged when editing content.                          |

The strict contracts live in [schema.ts](../shared/content/schema.ts). Unexpected keys and wrong types fail validation. Fields are required unless explicitly nullable. Use JSON `null` for absent duration or timing, and `[]` for an empty tracklist; do not use empty strings or invented zero values for missing information.

Edit titles, artists, descriptions, and track information directly, then run:

```sh
pnpm exec prettier --write content
pnpm check:content
pnpm verify
```

Checks are read-only and name the affected file and field. `pnpm build` runs the same content check before building, so it also rejects invalid authoring. No private WordPress files, SQL dump, media directory, environment file, credentials, or live feed is needed. Dependencies are installed separately using the setup in [README.md](../README.md).

## Episode fields and new episodes

Imported IDs use `wp-<original post ID>`. A new episode may use another stable lowercase ASCII ID such as `new-mix-2026`. IDs and slugs contain only lowercase letters, digits, and single separating hyphens. They must be unique. Copy an existing episode as a starting point, then explicitly update all identifying fields, publication data, asset references, description, and tracks.

- `schemaVersion` is `1`.
- `id` matches the filename. `slug` reserves the future route `/episodes/<slug>`. Existing slugs were derived once from observed legacy page URLs; title edits never regenerate them.
- `status` is `published` or `draft`. Published records require `publishedAt` in UTC with milliseconds, for example `2026-09-08T12:00:00.000Z`. The calendar date must be real. Future-dated published authoring is rejected; keep the record draft until actually publishing. Drafts may use `publishedAt: null`. Draft tooling and scheduled publication are M8 work.
- `title` and `artist` are nonblank plain text. Literal text such as `A & B` and `<3` is allowed; HTML tags and control characters are rejected.
- `guid` is an opaque, stable identifier and `guidIsPermalink` is a JSON boolean. For a new non-permalink GUID, assign a unique permanent value; never derive or regenerate it from editable titles or URLs.
- `audioAssetId` and `artworkAssetId` must resolve to assets of the appropriate kind. Every episode requires both. Two published episodes cannot share an enclosure URL.
- `durationSeconds` is a positive finite number or `null`. Numeric seconds may retain fractional precision.
- `tracks` contains ordered `position`, `artist`, `title`, and `startTime` fields. Positions start at 1 without gaps. Known starts are nonnegative and strictly increase even across untimed rows. They must precede a known episode duration. A start of `0` means the beginning of the recording. `null` means unknown. Partial timing is valid; do not sort, clamp, or discard rows to make validation pass.

Validation permits additional valid episodes; the public repository has no permanent 55-episode limit. Lists and detail lookup use the same publication predicate and order: newest publication first, then ascending stable ID for ties. Drafts and future records are withheld defensively by every public consumer. Content committed to this public repository is visible in Git even when withheld from the application.

## Safe descriptions

`descriptionHtml` holds the full description, not a feed excerpt. Allowed tags are `p`, `br`, `a`, `strong`, `em`, `ul`, `ol`, `li`, and `blockquote`. Links may have only `href` and `title`, and their schemes are HTTP/HTTPS; protocol-relative links are removed. Styles, classes, handlers, scripts, embedded players, SVG, and images are not allowed.

Store canonical sanitized HTML. A validation error includes the normalized candidate so you can review and apply it yourself; the checker never rewrites a description. Plain ampersands in HTML text/attributes are serialized as `&amp;`; do not repeatedly decode entities. For example:

```json
"descriptionHtml": "<p>A &amp; B return with another mix.</p>"
```

Emoji belong in text. The importer preserved the historical `wp-269` WordPress smiley as `😀`, without retaining its remote image. It also preserved the observed typographic apostrophes in `wp-428` and `wp-444`. The one legacy Windows-1252 apostrophe in `wp-281`, track 4, is corrected to `’` with an explicit report entry. The original evidence remains in M0.

## Assets and historical compatibility

Each asset has an immutable ID, kind (`audio` or `artwork`), absolute HTTP/HTTPS `url`, appropriate `mediaType`, positive integer `byteLength`, lowercase 64-character `sha256`, and provenance `sourceRoot`/`relativePath`. M2 supports `audio/mpeg`, `image/jpeg`, and `image/png`. Provenance roots are `audio` or `uploads`; paths are relative, without traversal or backslashes. Audio download filenames come from the original relative filename, not from a re-decoded URL.

Preserve the exact audited enclosure URL, including case, apostrophes, `%26`, and `%27`. Validation parses URLs but returns the original string. Media URLs cannot contain credentials, fragments, invalid percent escapes, or unsafe schemes. The initial artwork URLs use the existing uploads URL base and individually encoded path segments. Hashes and byte lengths come from the files, not guesses. Normal validation checks this metadata without opening media files or claiming they are reachable. M5 owns delivery checks and copying to production storage.

Historical IDs, slugs, publication instants, published status, GUIDs/permalink booleans, audio identities/hashes, enclosure URL/type/length tuples, and observed legacy URL mappings are protected. Changing them requires a separately documented migration decision and a corresponding compatibility-check update. Ordinary editorial edits do not require reimport.

The initial import includes the [Praxis correction evidence](milestones/evidence/M02-praxis-duration.json): duration **3396.349388 seconds** and all 21 precise starts, copied from the original split listing. Rounded screenshot durations are not accumulated. Stale ACF byte counts for `wp-278` and `wp-340` remain provenance; the agreeing local/podPress/enclosure byte lengths are used.

## Import and reconciliation

The importer reads the three frozen public M0 artifacts and the Praxis evidence JSON. Their exact hashes are pinned in the importer, and the report records all four hashes. Changed input evidence is an error requiring a new reviewed decision. No import command reads private source folders or contacts WordPress.

```sh
pnpm import:wordpress
pnpm import:wordpress --check --output content
pnpm import:wordpress --write --output .local/reviewed-candidate
```

The default is a dry run against `content/`. Its report lists files to create, identical files, conflicts, and archive counts. `--write` creates missing files only after validating the entire candidate and destination. Identical files remain untouched. Any changed or unknown file causes a conflict before writes begin, including new hand-authored episodes. Files are staged and linked exclusively so an existing destination cannot be overwritten. Failed writes remove only files created by that run; concurrent files and pre-existing edits remain intact. Symlink destinations and output overlapping migration evidence are rejected.

Exit codes are `0` for success, `2` for conflicts/reconciliation differences, and `1` for invalid inputs, options, or I/O failures. A dry run with missing files succeeds and reports the proposed creations; `--check` with missing files returns `2`. There is no `--force` mode.

After intentional edits, `import:wordpress --check` may correctly report differences while `check:content` passes. Reconciliation is not the permanent authoring gate. Generate a fresh candidate in `.local/`, review its diff, and manually merge approved changes. Never delete new author files to satisfy the original import report. `wordpress-import.json` fingerprints the initial output, not subsequent editorial revisions.

## Server consumers

The archive is packaged as Nitro server assets and loaded through one validated repository. Production caches the validated catalog; development reads it afresh. The production output runs independently of the checkout. Raw content, unused assets, private-source hashes, and import provenance are absent from API responses and public assets.

| Endpoint                   | Response                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/show`            | Public show metadata and resolved show-artwork URLs.                                                                                       |
| `GET /api/episodes`        | `{ "episodes": [...] }` with summaries in publication order; no tracklists or audio preload.                                               |
| `GET /api/episodes/<slug>` | Full published detail, safe description, GUID, resolved audio metadata, and ordered tracks. Unknown and unpublished slugs return HTTP 404. |

Server-side feed work should call `contentRepository.publicArchive(asOf)` from `server/utils/content.ts`; it returns full public records and the show using the same predicate as the list and detail APIs. Page code should use the public DTO types from `shared/content/public.ts`. Do not create a second archive, sort order, or publication rule. RSS serialization, redirects, episode pages, playback controls, media delivery, and deployment remain their later milestones.
