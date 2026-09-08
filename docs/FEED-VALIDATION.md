# Podcast feed validation

The replacement RSS is served at `/feed/podcast` from the canonical archive. Its production identity remains `https://nurevolution.net/feed/podcast`. No WordPress, private export, external validator, or media download is needed for the automated checks.

## Routine authoring and CI

Use the pinned toolchain described in [README.md](../README.md):

```sh
pnpm check:content
pnpm check:feed
CI=1 pnpm verify
```

`check:content` validates authored records and protects the historical archive. `check:feed` additionally serializes the entire public archive, parses it with an independent XML parser, and checks every channel/item field and all 55 historical identities against the frozen import. The command is read-only, accepts `--output <content-directory>`, and prints item count, oldest/newest IDs, historical comparison count, XML byte length, and SHA-256. It exits 0 on success and 1 on invalid input, changed protected history, malformed XML, or a semantic mismatch. Errors name the field/item. Normal builds run both checks before Nuxt builds; CI runs the same `pnpm verify` gate.

The gate allows valid additional episodes and editorial changes. It keeps existing GUIDs/flags, publication instants, enclosure URLs/types/lengths, and legacy mappings protected. Maintain whole-second publication instants (`.000Z`); fractional seconds cannot be represented faithfully in RSS publication dates and fail the feed check. The recorded [Praxis correction](milestones/evidence/M02-praxis-duration.json) remains canonical at 3396.349388 seconds and appears in RSS as duration `3396`.

The independent checker is a development tool, never a server dependency. Browser checks fetch the actual built feed in all three existing projects. The production portability check launches a copy containing only `.output` and verifies the complete feed. Unit tests additionally cover hidden/future records, exact publication boundaries, XML escaping/CDATA, malformed content, conditional requests, and error recovery. No browser retry or relaxed coverage threshold is used.

Do not run the original WordPress import over authored content. Its unchanged M2 candidate now differs from `content/show.json` because M3 adds verified RSS settings. `pnpm import:wordpress --check --output content` correctly reports that reconciliation conflict with exit 2. See [content authoring](CONTENT.md#show-rss-settings).

## Deployed behavior to preserve

| Request or condition                          | Expected behavior                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET `/feed/podcast`                           | 200 with the complete RSS, `application/rss+xml; charset=utf-8`, `X-Content-Type-Options: nosniff`; no authentication, cookies, browser challenge, or HTML shell.                                                              |
| HEAD `/feed/podcast`                          | Same representation headers as GET, no body.                                                                                                                                                                                   |
| GET/HEAD `/feed/podcast/` or `/?feed=podcast` | One 301 to relative `/feed/podcast`; the query alias requires exactly one lowercase `feed=podcast` on `/`.                                                                                                                     |
| Unsupported methods on these feed paths       | 405, `Allow: GET, HEAD`, non-cacheable plain text.                                                                                                                                                                             |
| Unrelated home/query/API/episode paths        | Normal application routing. `/wp/?feed=podcast` and `/wp/feed/podcast` were empty legacy feeds and are not podcast aliases.                                                                                                    |
| Successful feed, redirect, or 304 caching     | `Cache-Control: public, max-age=60, must-revalidate`. No unbounded stale response cache.                                                                                                                                       |
| ETag                                          | Weak SHA-256 validator of the XML bytes. Identical visible content has identical bytes and validator across requests/restarts. Rendered edits and publication change it; hidden records and non-rendered track changes do not. |
| Matching `If-None-Match`                      | 304 without a body, retaining ETag and cache policy. Strong/weak equivalents, lists, and wildcard work. Malformed/nonmatching headers cannot falsely return 304.                                                               |
| `If-Modified-Since` alone                     | Normal 200/HEAD response; the feed has no trustworthy editorial Last-Modified value and does not emit one.                                                                                                                     |
| Content load/serialization failure            | 503, `text/plain; charset=utf-8`, `Cache-Control: no-store`, generic message; HEAD has no body. No successful ETag or partial archive.                                                                                         |

The channel's Atom self link always names the canonical production feed, including on preview hosts. Historical item links retain their exact old URLs; M4 must redirect those pages to `/episodes/<saved-slug>` before WordPress retirement. New episodes use saved-slug URLs. Both show-artwork paths and all enclosure URLs remain unchanged.

The new feed uses complete sanitized descriptions and canonical artist/title data. The [M3 plan](milestones/M03-podcast-rss.md#reviewed-differences-from-the-legacy-feed) records the small title/author differences, duration formatting, clean-label spelling, and removed WordPress fields. Its [reference evidence](milestones/evidence/M03-feed-reference.json) matches M0's raw feed hash and retains all 55 legacy title/author/explicit values. Never regenerate those historical references to hide a regression.

## Public rehearsal — pending M5

Perform these checks on a public rehearsal URL with production-equivalent TLS, routing, compression, caching, and media delivery. Record the URL, tested application commit, UTC date, tool/client versions, results, and any outstanding issue. A localhost XML check does not establish public reachability or podcast-directory acceptance.

- Fetch GET and HEAD without a browser session. Verify the response table above, redirects, public DNS/TLS, MIME types, ETags after compression, and an editorial update followed by revalidation. Verify the proxy does not impose a long HTML-cache lifetime or ignore the feed's cache policy.
- Run an external podcast-feed validator against the reachable rehearsal feed and retain its report. Distinguish feed/XML problems from known differences in rehearsal media reachability. A staging feed's canonical self link is intentional; record any validator finding about it for the final canonical-URL check.
- Verify both show-artwork URLs, their actual response formats, and successful HEAD behavior. The hash-matched local iTunes image has a 1500×1500 JPEG frame; the RSS thumbnail is 144×144. Ignore misleading Exif dimensions. Confirm the delivered images match the intended files and Apple's current show-cover requirements. [Apple show cover](https://podcasters.apple.com/support/5514-show-cover-template)
- Under the M5 media plan, verify all enclosure URLs preserve their exact spelling and serve the audited byte lengths/media types. Check HEAD, range requests (206 and appropriate Content-Range), redirects, seeking and full downloads with representative clients, then complete the archive-wide delivery checks. Audio remains on droplet storage for R1; Spaces is post-release. [Apple delivery requirements](https://podcasters.apple.com/support/823-podcast-requirements)
- Rehearse restoring the previous application/feed serving path at the same URL, preserving media and invalidating affected caches. Keep the prior working release until cutover acceptance and rollback readiness are established.

## Canonical URL and clients — pending M6

Repeat the rehearsal checks against `https://nurevolution.net/feed/podcast` after the controlled cutover. Confirm historical page redirects and media paths first.

Use an existing subscription in Apple Podcasts where available and at least one other podcast client. Refresh it and check for duplicate/missing episodes, the oldest and newest archive entries, show metadata/artwork, description links, and successful downloads/streaming. Retain observations and client versions. Client caching may exceed the server's advertised freshness, so record observation times.

Use the owner's existing directory access to validate the established listing when available. Do not create a second show or submit a rehearsal feed as a new listing. If account/client access is unavailable, leave the corresponding check pending with a concrete follow-up. Technical validation and directory approval are separate results. [Apple validation guidance](https://podcasters.apple.com/support/829-validate-your-podcast)

M8 must review the 60-second HTTP cache window, any intermediary caches, client polling, and publication-boundary behavior before claiming scheduled release precision. M9 may add episode artwork or chapters through separately validated canonical metadata; neither feature is emitted by M3.

## Evidence record

M3's local implementation results are recorded in its [completion evidence](milestones/M03-podcast-rss.md#completion-evidence). Public rehearsal, actual client refresh, production delivery, and directory checks remain **pending M5/M6**. Record results in the relevant milestone; do not mark them complete from an automated local test.
