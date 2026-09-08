# Migration audit and compatibility contract

Status: **audit complete; migration ready**

Source snapshot: `nurevolution-sources-2026-09-07`. Frozen feed retrieved 2026-09-07T02:08:25Z.

## Reconciliation

| Evidence | Count |
| --- | ---: |
| WordPress `one_page_portfolio` records | 55 |
| Published records assigned `migrate` | 55 |
| Frozen production feed items | 55 |
| Local MP3 files | 55 |
| Verified image files under supplied artwork roots | 101 |
| Episode-associated artwork originals | 55 |
| Associated generated artwork derivatives | 16 |
| Unassociated uploads images and derivatives | 30 |
| Identical artwork byte groups | 2 |
| Blocking discrepancies | 0 |
| Non-blocking discrepancies | 3 |

The database, feed, and media collections each identify 55 published episodes. Every discovered podcast record has a disposition, and each feed item is either mapped once or named in the discrepancy register.

50 episodes contain 832 ordered track rows. 5 episodes have no tracklist. Owner-supplied split-FLAC durations provide 317 derived start times across 21 episodes. All 55 frozen GUIDs explicitly use `isPermaLink="false"`. 13 database GUID strings encode the query-string ampersand as `&#038;`; XML entity decoding exposes `&` to feed consumers, and both representations remain recorded.

All 55 podcast records have WordPress status `publish` and disposition `migrate`; there are no draft, scheduled, trashed, excluded, or unresolved podcast records. The two Mega 93.3 FM parts are distinct records (`wp-342` and `wp-344`) with distinct enclosures and local files. There are no duplicate feed GUIDs, duplicate enclosure URLs, ambiguous matches, missing MP3s, or orphan MP3s. Because the frozen feed contains all 55 published records, there is no evidence that its current item limit truncates the archive. Unassociated uploads remain inventoried as non-episode images or derivatives rather than being silently assigned.

## Show evidence

The frozen channel title is `nurevolution studios` and its observed feed self-migration target is `https://nurevolution.net/feed/podcast`. The standard RSS artwork URL is `https://nurevolution.net/wp/wp-content/uploads/2013/03/07-06-16-144px.jpg`; the iTunes artwork URL is `https://nurevolution.net/wp/wp-content/uploads/2013/03/07-06-16.jpg`. Both resolve to verified files in the supplied uploads snapshot and their asset IDs are retained in the inventory.

## Source mapping

| Canonical migration concern | WordPress/database evidence | Subscriber-facing evidence |
| --- | --- | --- |
| Episode identity | `database` `nurevolution.sql`, `one_page_portfolio` post ID and `guid` | RSS `guid` text plus the explicit `isPermaLink` attribute |
| Publication | `post_date` and `post_date_gmt` | RSS `pubDate`; conflicts must preserve both values |
| Audio | ACF `file_name`, `file_size_(in_bytes)`, `duration`; serialized `_podPressMedia` | RSS enclosure URL, type, and length |
| Artwork | `_thumbnail_id` -> attachment `_wp_attached_file` -> supplied uploads root | No per-item image; channel-level RSS and iTunes show images |
| Description | WordPress post content/excerpt | RSS description and `content:encoded` |
| Tracklist | ACF repeater count `tracklist` and `tracklist_<n>_track_artist` / `_track_title`; owner-supplied split-FLAC durations for derived starts | Not relied upon |
| Legacy page URL | Source record ID plus observed WordPress routing | RSS item `link` stored in `legacy-urls.json` |

The WordPress option `permalink_structure` was `/%category%/%postname%`. The database timezone string is `(empty)` with GMT offset `-6`; UTC publication evidence therefore remains authoritative for instants.

## Generation behavior traced in source

- The `ninezeroseven` theme registers `one_page_portfolio` as the public podcast record type with rewrite slug `podcast`; its single template reads ACF `title`, `artist`, `file_name`, and the `tracklist` repeater in source order.
- WordPress core `wp-includes/feed-rss2.php` emits the item link through `the_permalink_rss()`, formats `post_date_gmt` as RFC 822 `+0000`, and emits `the_guid()` with `isPermaLink="false"`.
- podPress `podpress_feed_functions.php` reads serialized `_podPressMedia`, converts the stored URI to a web path, emits its stored `size` and MIME type as the enclosure, and normalizes its stored duration for `itunes:duration`.
- The episode template constructs its historical direct-download URL as `//podcast.nurevolution.net/dl.php?file=` plus the ACF filename. This is download behavior evidence, not a canonical media URL decision for M2/M5.

## Compatibility contract

- Preserve every frozen RSS GUID string exactly and preserve its `isPermaLink` semantics. A URL-shaped GUID is an opaque subscriber identity when `isPermaLink="false"`.
- Preserve the original enclosure URL, media type, byte length, and filename evidence. Do not rename source MP3 files during import.
- Preserve database-local, database-UTC, and feed publication representations until M2 establishes the canonical instant and reports any conflict.
- Map legacy page URLs to source episode IDs. This audit does not select future slugs or canonical routes.
- Tracklists are ordered ACF repeater data. Where owner-supplied numbered split FLACs reconcile to the episode track count and master duration, `startTime` is the cumulative duration of preceding splits. Untimed tracks remain explicitly absent.
- Episode artwork is file-backed through WordPress attachments. No binary artwork payload or data-URL metadata was found in the episode tables; security-plugin binary columns are unrelated. Generated derivatives are linked to their originals in `artworkEvidence`; 2 upload groups have identical bytes, and 0 of those groups contain multiple episode originals.
- Missing tracklists or timestamps are valid optional data. Missing audio, artwork, ambiguous identities, malformed dates, and byte-length conflicts are explicit blockers.

## Discrepancy register

- `M0-ACF-SIZE-278` (non-blocking): The duplicate ACF byte-length field is stale; local, podPress, and frozen enclosure sizes agree. Evidence: `{"acfByteLength": 117345588, "enclosureByteLength": 117345591, "localByteLength": 117345591, "podPressByteLength": 117345591}`
- `M0-ACF-SIZE-340` (non-blocking): The duplicate ACF byte-length field is stale; local, podPress, and frozen enclosure sizes agree. Evidence: `{"acfByteLength": 44030047, "enclosureByteLength": 44030050, "localByteLength": 44030050, "podPressByteLength": 44030050}`
- `M0-TRACK-TIMING-417` (non-blocking): Derived timestamps were withheld because split-FLAC durations do not reconcile to the episode duration. Evidence: `{"durationDifferenceSeconds": -19.650612, "episodeDurationSeconds": 3416, "splitDurationSeconds": 3396.349388}`

## Reproducibility and private evidence

Raw SQL, the source-location manifest, database JSONL export, full per-file provenance manifest, and frozen feed response remain outside this public repository. Public paths retain only source-root labels and relative paths.

The database was restored offline with `mariadb:11.3.2-jammy` at digest `sha256:e101f9db31916a5d4d7d594dd0dd092fb23ab4f499f1d7a7425d1afd4162c4bc`, with no published ports and `--network none`. The source dump reports MariaDB 11.3.2 and the private evidence export records the discovered `11.3.2-MariaDB-1:11.3.2+maria~ubu2204` server version.

```text
docker pull mariadb:11.3.2-jammy
docker run -d --name nurevolution-m0-db --network none -e <temporary-root-password> mariadb:11.3.2-jammy
docker exec -i nurevolution-m0-db mariadb -uroot -p<temporary-root-password> < /private/path/nurevolution.sql
python3 tools/migration/audit.py export-database --container nurevolution-m0-db --database nurevolution_wp --output-dir /private/database-export
python3 tools/migration/audit.py capture-feed --output-dir /private/reference
python3 tools/migration/audit.py reconcile --sources /private/source-manifest.json --reference-dir /private/reference --database-export /private/database-export --track-timings docs/migration/track-timings.json --output-dir docs/migration
python3 tools/migration/audit.py check --inventory docs/migration/inventory.json --legacy-urls docs/migration/legacy-urls.json --track-timings docs/migration/track-timings.json
python3 -m unittest discover -s tools/migration/tests -p 'test_*.py'
docker rm -v nurevolution-m0-db
```

`capture-feed` is the only command that contacts production. `reconcile` reads frozen evidence and deterministically rewrites the substantive public artifacts. The full private manifest binds each path to a source-root label, relative path, byte length, and SHA-256 checksum.

## M2/M3 handoff

M2 should import all `migrate` records, use the inventory asset references, retain every identity representation, and preserve the supplied or derived timestamp provenance. Untimed tracks must remain untimed. M3 should compare its generated feed against the frozen GUID/enclosure/publication contract and keep `/feed/podcast` compatible. Records named by blocking issues require resolution before migration readiness.

There are 55 observed legacy episode-page URLs. New canonical slugs and routes remain intentionally undecided.

No historical traffic evidence was supplied, so this audit adds no sizing claim for M5.

## Verification evidence

The repeatable artifact check validates episode and asset references, timing order and completeness, timing-evidence correspondence, issue counts, and legacy URL targets. Exact commands and current local results are recorded in the M0 milestone handoff.
