import { z } from 'zod'

export const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const textSchema = z
  .string()
  .refine(
    (value) =>
      value.trim().length > 0 && !/\p{Cc}|<\/?[a-z][^>]*>/iu.test(value),
    'Expected nonblank plain text without markup or control characters',
  )
export const instantSchema = z.iso
  .datetime({ precision: 3 })
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    'Expected a real UTC calendar instant with milliseconds',
  )
export const urlSchema = z.string().refine((value) => {
  if (!/^https?:\/\//.test(value) || /[\s\\]|%(?![a-f\d]{2})/i.test(value))
    return false
  try {
    const url = new URL(value)
    return Boolean(url.hostname) && !url.username && !url.password && !url.hash
  } catch {
    return false
  }
}, 'Expected an absolute HTTP(S) URL without credentials, fragments, or invalid escapes')
export const relativePathSchema = z
  .string()
  .refine(
    (value) =>
      !/[\\\p{Cc}]/u.test(value) &&
      value
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..'),
    'Expected a relative path without traversal',
  )

export const trackSchema = z.strictObject({
  position: z.int().positive(),
  artist: textSchema,
  title: textSchema,
  startTime: z.number().nonnegative().nullable(),
})
export const episodeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: idSchema,
    slug: idSchema,
    status: z.enum(['published', 'draft']),
    publishedAt: instantSchema.nullable(),
    title: textSchema,
    artist: textSchema,
    descriptionHtml: z.string(),
    guid: z
      .string()
      .refine((value) => value.trim().length > 0 && !/\p{Cc}/u.test(value)),
    guidIsPermalink: z.boolean(),
    audioAssetId: idSchema,
    artworkAssetId: idSchema,
    durationSeconds: z.number().positive().nullable(),
    tracks: z.array(trackSchema),
  })
  .superRefine((episode, ctx) => {
    if (episode.status === 'published' && episode.publishedAt === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['publishedAt'],
        message: 'Published episodes require a publication instant',
      })
    }
    let previous = -1
    episode.tracks.forEach((track, index) => {
      if (track.position !== index + 1)
        ctx.addIssue({
          code: 'custom',
          path: ['tracks', index, 'position'],
          message: 'Positions must start at 1 without gaps',
        })
      if (track.startTime !== null) {
        if (
          track.startTime <= previous ||
          (episode.durationSeconds !== null &&
            track.startTime >= episode.durationSeconds)
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['tracks', index, 'startTime'],
            message:
              'Known starts must strictly increase and precede the duration',
          })
        }
        previous = track.startTime
      }
    })
  })
export const assetSchema = z
  .strictObject({
    id: idSchema,
    kind: z.enum(['audio', 'artwork']),
    url: urlSchema,
    mediaType: z.enum(['audio/mpeg', 'image/jpeg', 'image/png']),
    byteLength: z.int().positive(),
    sha256: hashSchema,
    sourceRoot: z.enum(['audio', 'uploads']),
    relativePath: relativePathSchema,
  })
  .refine(
    (asset) =>
      asset.kind === 'audio'
        ? asset.mediaType === 'audio/mpeg' && asset.sourceRoot === 'audio'
        : asset.mediaType !== 'audio/mpeg' && asset.sourceRoot === 'uploads',
    'Asset kind, media type, and source root must agree',
  )
export const showSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: idSchema,
  title: textSchema,
  descriptionText: textSchema,
  siteUrl: urlSchema,
  feedUrl: urlSchema,
  standardArtworkAssetId: idSchema,
  itunesArtworkAssetId: idSchema,
})
export const assetsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  assets: z.array(assetSchema),
})
export const legacySchema = z.strictObject({
  schemaVersion: z.literal(1),
  entries: z.array(z.strictObject({ url: urlSchema, episodeId: idSchema })),
})
export const countsSchema = z.strictObject({
  episodes: z.int().nonnegative(),
  tracks: z.int().nonnegative(),
  starts: z.int().nonnegative(),
  timedEpisodes: z.int().nonnegative(),
  assets: z.int().nonnegative(),
  legacyUrls: z.int().nonnegative(),
})
export const reportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  importerVersion: z.literal(1),
  sourceSnapshotId: idSchema,
  sourceHashes: z.record(relativePathSchema, hashSchema),
  expected: countsSchema,
  actual: countsSchema,
  metadataSources: z.strictObject({
    description: z.string(),
    publication: z.string(),
    guid: z.string(),
    enclosure: z.string(),
    artwork: z.string(),
  }),
  episodes: z.array(
    z.strictObject({
      id: idSchema,
      sourceId: z.int().positive(),
      slug: idSchema,
      file: relativePathSchema,
      audioAssetId: idSchema,
      artworkAssetId: idSchema,
      databaseGuidDiffers: z.boolean(),
      descriptionChanges: z.array(z.string()),
      textChanges: z.array(z.string()),
      timing: z.array(
        z.strictObject({
          position: z.int().positive(),
          source: z.string(),
          startTime: z.number().nonnegative().nullable(),
        }),
      ),
    }),
  ),
  issues: z.array(z.strictObject({ id: z.string(), disposition: z.string() })),
  outputHashes: z.record(relativePathSchema, hashSchema),
})

export type Episode = z.infer<typeof episodeSchema>
export type Asset = z.infer<typeof assetSchema>
export type Show = z.infer<typeof showSchema>
export type ImportReport = z.infer<typeof reportSchema>
export interface Catalog {
  show: Show
  episodes: Episode[]
  assets: Asset[]
  legacyUrls: z.infer<typeof legacySchema>['entries']
}
