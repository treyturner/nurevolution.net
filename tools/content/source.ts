import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { z } from 'zod'
import {
  assetSchema,
  countsSchema,
  hashSchema,
  idSchema,
  instantSchema,
  relativePathSchema,
  reportSchema,
  textSchema,
  trackSchema,
  urlSchema,
  type Catalog,
} from '../../shared/content/schema.ts'
import { importDescription } from '../../server/content/description.ts'
import {
  countCatalog,
  unique,
  validateCatalog,
} from '../../server/content/validate.ts'

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
export const inputPaths = {
  inventory: 'docs/migration/inventory.json',
  legacy: 'docs/migration/legacy-urls.json',
  timings: 'docs/migration/track-timings.json',
  correction: 'docs/milestones/evidence/M02-praxis-duration.json',
}
const snapshot = 'nurevolution-sources-2026-09-07'
export const expectedCounts = countsSchema.parse({
  episodes: 55,
  tracks: 832,
  starts: 338,
  timedEpisodes: 22,
  assets: 156,
  legacyUrls: 55,
})
export const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex')
export const jsonBytes = (value: unknown) =>
  `${JSON.stringify(value, null, 2)}\n`

const rawAsset = z.object({
  id: idSchema,
  kind: z.enum(['audio', 'artwork']),
  sourceRoot: z.enum(['audio', 'uploads']),
  relativePath: relativePathSchema,
  sha256: hashSchema,
  byteLength: z.int().positive(),
  verifiedMediaType: z.enum(['image/jpeg', 'image/png']).optional(),
})
const sourceEpisode = z.object({
  id: idSchema,
  artist: textSchema,
  title: textSchema,
  disposition: z.literal('migrate'),
  audioAssetId: idSchema,
  artworkAssetId: idSchema,
  descriptionHtml: z.string(),
  feedContentHtml: z.string(),
  sourceRecord: z.object({ id: z.int().positive() }),
  legacyUrls: z.array(urlSchema).min(1),
  originalIdentity: z.object({
    databaseGuid: z.string(),
    feedGuid: z.string(),
    feedGuidIsPermalink: z.boolean(),
  }),
  publication: z.object({ databaseUtc: z.string(), feedRfc822: z.string() }),
  databaseMedia: z.object({
    duration: z.string(),
    feedDuration: z.string(),
    byteLength: z.int().positive(),
    podPressByteLength: z.int().positive(),
    filename: relativePathSchema,
  }),
  enclosure: z.object({
    url: urlSchema,
    type: z.literal('audio/mpeg'),
    byteLength: z.int().positive(),
  }),
  artworkEvidence: z.object({ relativePath: relativePathSchema }),
  tracklist: z.object({
    count: z.int().nonnegative(),
    tracks: z.array(trackSchema.extend({ title: z.string() })),
  }),
})
const inventorySchema = z.object({
  formatVersion: z.literal(1),
  sourceSnapshots: z.object({ id: z.literal(snapshot) }),
  assets: z.array(rawAsset),
  episodes: z.array(sourceEpisode),
  show: z.object({
    title: textSchema,
    description: textSchema,
    link: urlSchema,
    newFeedUrl: urlSchema,
    standardArtworkAssetId: idSchema,
    itunesArtworkAssetId: idSchema,
    standardArtworkUrl: urlSchema,
    itunesArtworkUrl: urlSchema,
  }),
  issues: z.array(
    z.object({ id: z.string(), blocksMigration: z.literal(false) }),
  ),
})
const timingSchema = z.object({
  formatVersion: z.literal(1),
  id: idSchema,
  episodes: z.array(
    z.object({
      episodeId: idSchema,
      status: z.enum([
        'applied',
        'withheld-duration-mismatch',
        'continuous-only',
      ]),
      trackCount: z.int().nonnegative().optional(),
      splitDurationSeconds: z.number().nonnegative().nullable().optional(),
      tracks: z.array(
        z.object({
          position: z.int().positive(),
          startTime: z.number().nonnegative(),
          durationSeconds: z.number().positive(),
        }),
      ),
    }),
  ),
})
const legacySourceSchema = z.object({
  formatVersion: z.literal(1),
  sourceSnapshotId: z.literal(snapshot),
  entries: z.array(
    z.object({
      episodeId: idSchema,
      url: urlSchema,
      kind: z.literal('episode-page'),
    }),
  ),
})
const correctionSchema = z.object({
  formatVersion: z.literal(1),
  id: z.literal('m2-praxis-duration-2026-09-08'),
  episodeId: z.literal('wp-417'),
  sourceSnapshotId: z.literal(snapshot),
  inventorySha256: hashSchema,
  trackTimingsSha256: hashSchema,
  timingEvidenceId: idSchema,
  audioAsset: rawAsset.omit({ kind: true, verifiedMediaType: true }),
  canonicalDurationSeconds: z.literal(3396.349388),
  preciseSplitDurationSeconds: z.literal(3396.349388),
  legacyDurationSeconds: z.literal(3416),
  inspection: z.object({ durationSeconds: z.number().positive() }),
  decision: z.object({
    trackCount: z.literal(21),
    replaceDurationMetadata: z.literal(true),
    importPreciseStarts: z.literal(true),
    preserveFrozenM0Artifacts: z.literal(true),
    supersedesForCanonicalImport: z.literal('M0-TRACK-TIMING-417'),
  }),
})

export interface SourceDocuments {
  inventory: unknown
  legacy: unknown
  timings: unknown
  correction: unknown
  hashes: Record<string, string>
}

export async function readSources(
  root = projectRoot,
): Promise<SourceDocuments> {
  const expected = [
    '06b0de23c9a22959acf721c9fc9be82e49691a89ab8cc355fc808b7567aa42fe',
    '0faa24917ba86aa6bbb76fee19698be2da2f05a208b0b47dfb269352f14fe49f',
    'dd787d166708f4c5b727089a2c6f35aee5b113b7bfac40e907a1cc5f1a7aaed7',
    '8b83af522374a834ae9354644edb2da9b10c78e3c9359bd9f43b312d0f65ec98',
  ]
  const hashes: Record<string, string> = {}
  const documents = await Promise.all(
    Object.values(inputPaths).map(async (path, index) => {
      const bytes = await readFile(resolve(root, path), 'utf8')
      hashes[path] = sha256(bytes)
      if (hashes[path] !== expected[index])
        throw new Error(
          `${path}: frozen input hash changed; review a new migration decision`,
        )
      return JSON.parse(bytes) as unknown
    }),
  )
  return {
    inventory: documents[0],
    legacy: documents[1],
    timings: documents[2],
    correction: documents[3],
    hashes,
  }
}

export function parseDuration(value: string): number {
  if (!/^\d+:\d{2}(?::\d{2})?$/.test(value))
    throw new Error(`Invalid duration: ${value}`)
  const parts = value.split(':').map(Number)
  if (parts.slice(1).some((n) => n >= 60))
    throw new Error(`Invalid duration components: ${value}`)
  const seconds = parts.reduce((sum, part) => sum * 60 + part, 0)
  if (!Number.isSafeInteger(seconds) || seconds <= 0)
    throw new Error(`Invalid duration total: ${value}`)
  return seconds
}

export function publicationInstant(
  databaseUtc: string,
  feedRfc822: string,
): string {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(databaseUtc))
    throw new Error('Invalid database UTC publication')
  const instant = instantSchema.parse(`${databaseUtc.replace(' ', 'T')}.000Z`)
  if (
    !/(?:[+-]\d{4}|GMT|UT)$/.test(feedRfc822) ||
    Date.parse(feedRfc822) !== Date.parse(instant)
  )
    throw new Error('Feed/database publication mismatch')
  return instant
}

export function deriveSlugs(
  entries: { id: string; url: string }[],
): Map<string, string> {
  unique(
    entries.map((e) => e.id),
    'source id',
  )
  const initial = entries.map(({ id, url }) => ({
    id,
    slug: decodeURIComponent(new URL(url).pathname.split('/').at(-1)!)
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
  }))
  for (const { id, slug } of initial)
    if (!slug) throw new Error(`${id}: empty slug candidate`)
  const counts = new Map<string, number>()
  for (const { slug } of initial) counts.set(slug, (counts.get(slug) ?? 0) + 1)
  const result = new Map(
    initial.map(({ id, slug }) => [
      id,
      counts.get(slug)! > 1 ? `${slug}-${id}` : slug,
    ]),
  )
  unique([...result.values()], 'derived slug')
  return result
}

export function createCandidate(input: SourceDocuments) {
  const inventory = inventorySchema.parse(input.inventory)
  const legacy = legacySourceSchema.parse(input.legacy)
  const timings = timingSchema.parse(input.timings)
  const correction = correctionSchema.parse(input.correction)
  if (
    input.hashes[inputPaths.inventory] !== correction.inventorySha256 ||
    input.hashes[inputPaths.timings] !== correction.trackTimingsSha256
  )
    throw new Error('Correction input hash mismatch')
  if (correction.timingEvidenceId !== timings.id)
    throw new Error('Correction timing evidence mismatch')
  unique(
    inventory.assets.map((a) => a.id),
    'source asset id',
  )
  unique(
    timings.episodes.map((e) => e.episodeId),
    'timing episode id',
  )
  const assetById = new Map(inventory.assets.map((a) => [a.id, a]))
  const slugs = deriveSlugs(
    inventory.episodes.map((e) => ({ id: e.id, url: e.legacyUrls[0]! })),
  )
  const artworkUrl = (path: string) =>
    `https://nurevolution.net/wp/wp-content/uploads/${path.split('/').map(encodeURIComponent).join('/')}`
  const assets = inventory.assets
    .map((raw) => {
      const episode = inventory.episodes.find((e) => e.audioAssetId === raw.id)
      return assetSchema.parse({
        id: raw.id,
        kind: raw.kind,
        sourceRoot: raw.sourceRoot,
        relativePath: raw.relativePath,
        sha256: raw.sha256,
        byteLength: raw.byteLength,
        url:
          raw.kind === 'audio'
            ? episode?.enclosure.url
            : artworkUrl(raw.relativePath),
        mediaType: raw.kind === 'audio' ? 'audio/mpeg' : raw.verifiedMediaType,
      })
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  const show = {
    schemaVersion: 1 as const,
    id: 'nurevolution',
    title: inventory.show.title,
    descriptionText: inventory.show.description,
    siteUrl: inventory.show.link,
    feedUrl: inventory.show.newFeedUrl,
    standardArtworkAssetId: inventory.show.standardArtworkAssetId,
    itunesArtworkAssetId: inventory.show.itunesArtworkAssetId,
  }
  for (const [id, url] of [
    [show.standardArtworkAssetId, inventory.show.standardArtworkUrl],
    [show.itunesArtworkAssetId, inventory.show.itunesArtworkUrl],
  ]) {
    if (assets.find((a) => a.id === id)?.url !== url)
      throw new Error('Show artwork URL construction mismatch')
  }
  const mappings: z.infer<typeof reportSchema>['episodes'] = []
  const episodes = [...inventory.episodes]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((raw) => {
      if (
        raw.id !== `wp-${raw.sourceRecord.id}` ||
        raw.tracklist.count !== raw.tracklist.tracks.length
      )
        throw new Error(`${raw.id}: source identity/track count mismatch`)
      const audio = assetById.get(raw.audioAssetId)
      const artwork = assetById.get(raw.artworkAssetId)
      if (
        !audio ||
        audio.byteLength !== raw.enclosure.byteLength ||
        audio.byteLength !== raw.databaseMedia.podPressByteLength ||
        audio.relativePath !== decodeURIComponent(raw.databaseMedia.filename)
      )
        throw new Error(`${raw.id}: audio evidence mismatch`)
      if (artwork?.relativePath !== raw.artworkEvidence.relativePath)
        throw new Error(`${raw.id}: artwork evidence mismatch`)
      if (
        raw.databaseMedia.byteLength !== audio.byteLength &&
        !['wp-278', 'wp-340'].includes(raw.id)
      )
        throw new Error(`${raw.id}: unreviewed ACF size mismatch`)
      let duration = parseDuration(raw.databaseMedia.duration)
      if (duration !== parseDuration(raw.databaseMedia.feedDuration))
        throw new Error(`${raw.id}: feed/database duration mismatch`)
      const timing = timings.episodes.find((e) => e.episodeId === raw.id)
      const textChanges: string[] = []
      let tracks = raw.tracklist.tracks.map((track) => {
        if (
          raw.id === 'wp-281' &&
          track.position === 4 &&
          track.title ===
            'Funky Nawari (Drumspyder\u0092s Midnight Snack Wrap Up)'
        ) {
          textChanges.push(
            'Track 4: decoded legacy Windows-1252 U+0092 apostrophe as U+2019',
          )
          return { ...track, title: track.title.replace('\u0092', '’') }
        }
        return track
      })
      if (raw.id === correction.episodeId) {
        const proof = correction.audioAsset
        if (
          audio.id !== proof.id ||
          audio.sha256 !== proof.sha256 ||
          audio.byteLength !== proof.byteLength ||
          audio.relativePath !== proof.relativePath ||
          audio.sourceRoot !== proof.sourceRoot ||
          duration !== correction.legacyDurationSeconds
        )
          throw new Error('Praxis correction audio identity mismatch')
        if (
          !timing ||
          timing.status !== 'withheld-duration-mismatch' ||
          timing.trackCount !== 21 ||
          timing.tracks.length !== tracks.length ||
          timing.splitDurationSeconds !== correction.canonicalDurationSeconds ||
          Math.abs(
            correction.inspection.durationSeconds -
              correction.canonicalDurationSeconds,
          ) > 0.000001
        )
          throw new Error('Praxis correction timing mismatch')
        duration = correction.canonicalDurationSeconds
        tracks = tracks.map((track, index) => {
          const split = timing.tracks[index]!
          if (split.position !== track.position)
            throw new Error('Praxis correction position mismatch')
          return { ...track, startTime: split.startTime }
        })
        const end = timing.tracks.at(-1)!
        if (Math.abs(end.startTime + end.durationSeconds - duration) > 0.000001)
          throw new Error('Praxis correction split total mismatch')
      } else if (timing?.status === 'applied') {
        if (
          timing.tracks.length !== tracks.length ||
          tracks.some(
            (t, i) =>
              t.position !== timing.tracks[i]!.position ||
              t.startTime !== timing.tracks[i]!.startTime,
          )
        )
          throw new Error(`${raw.id}: applied timing mismatch`)
      } else if (tracks.some((t) => t.startTime !== null))
        throw new Error(`${raw.id}: unexplained timestamp`)
      const description = importDescription(
        raw.feedContentHtml,
        raw.descriptionHtml,
        raw.id,
      )
      const episode = {
        schemaVersion: 1 as const,
        id: raw.id,
        slug: slugs.get(raw.id)!,
        status: 'published' as const,
        publishedAt: publicationInstant(
          raw.publication.databaseUtc,
          raw.publication.feedRfc822,
        ),
        title: raw.title,
        artist: raw.artist,
        descriptionHtml: description.html,
        guid: raw.originalIdentity.feedGuid,
        guidIsPermalink: raw.originalIdentity.feedGuidIsPermalink,
        audioAssetId: raw.audioAssetId,
        artworkAssetId: raw.artworkAssetId,
        durationSeconds: duration,
        tracks,
      }
      mappings.push({
        id: raw.id,
        sourceId: raw.sourceRecord.id,
        slug: episode.slug,
        file: `episodes/${raw.id}.json`,
        audioAssetId: raw.audioAssetId,
        artworkAssetId: raw.artworkAssetId,
        databaseGuidDiffers: raw.originalIdentity.databaseGuid !== episode.guid,
        descriptionChanges: description.changes,
        textChanges,
        timing: tracks.map((t) => ({
          position: t.position,
          startTime: t.startTime,
          source:
            t.startTime === null
              ? 'absent'
              : raw.id === correction.episodeId
                ? correction.id
                : timings.id,
        })),
      })
      return episode
    })
  const legacyUrls = legacy.entries
    .map(({ url, episodeId }) => ({ url, episodeId }))
    .sort((a, b) => (a.url < b.url ? -1 : 1))
  for (const episode of inventory.episodes) {
    if (
      jsonBytes(
        legacyUrls
          .filter((e) => e.episodeId === episode.id)
          .map((e) => e.url)
          .sort(),
      ) !== jsonBytes([...episode.legacyUrls].sort())
    )
      throw new Error(`${episode.id}: legacy URL evidence mismatch`)
  }
  const catalog = validateCatalog({
    show,
    assets: { schemaVersion: 1, assets },
    legacyUrls: { schemaVersion: 1, entries: legacyUrls },
    episodes: episodes.map((e) => ({
      file: `episodes/${e.id}.json`,
      value: e,
    })),
  })
  const actual = countCatalog(catalog)
  if (jsonBytes(actual) !== jsonBytes(expectedCounts))
    throw new Error(`Import count mismatch: ${jsonBytes(actual)}`)
  const files = catalogFiles(catalog)
  const report = reportSchema.parse({
    schemaVersion: 1,
    importerVersion: 1,
    sourceSnapshotId: snapshot,
    sourceHashes: Object.fromEntries(
      Object.entries(input.hashes).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    expected: expectedCounts,
    actual,
    metadataSources: {
      description:
        'Full feedContentHtml checked against database descriptionHtml; normalized safe HTML',
      publication: 'databaseUtc checked against feedRfc822',
      guid: 'Literal parsed feed GUID and boolean',
      enclosure:
        'Frozen feed URL/type/length, agreeing with local and podPress size',
      artwork: 'Verified file media type and encoded raw uploads path',
    },
    episodes: mappings,
    issues: inventory.issues.map((issue) => ({
      id: issue.id,
      disposition:
        issue.id === correction.decision.supersedesForCanonicalImport
          ? `Corrected duration and 21 starts using ${correction.id}; M0 preserved`
          : 'Retained stale ACF provenance; local/podPress/enclosure sizes selected',
    })),
    outputHashes: Object.fromEntries(
      [...files].map(([path, bytes]) => [path, sha256(bytes)]),
    ),
  })
  files.set('wordpress-import.json', jsonBytes(report))
  return { catalog, report, files }
}

function catalogFiles(catalog: Catalog): Map<string, string> {
  return new Map([
    ['show.json', jsonBytes(catalog.show)],
    ['assets.json', jsonBytes({ schemaVersion: 1, assets: catalog.assets })],
    [
      'legacy-urls.json',
      jsonBytes({ schemaVersion: 1, entries: catalog.legacyUrls }),
    ],
    ...catalog.episodes.map((episode): [string, string] => [
      `episodes/${episode.id}.json`,
      jsonBytes(episode),
    ]),
  ])
}
