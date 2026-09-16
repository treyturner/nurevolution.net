import { z } from 'zod'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const virtualSchema = z.strictObject({
  sha256: hash,
  headerSha256: hash,
  headerByteLength: integer.positive().max(8 * 1024 * 1024),
  byteLength: integer.positive(),
  audioOffset: integer,
  audioByteLength: integer.positive(),
  samples: integer.positive(),
  sampleRate: z.literal(44100),
  pcmSha256: z.array(hash).min(1).max(2),
})
export const playbackEntrySchema = z
  .strictObject({
    assetId: z.string().regex(/^[a-z0-9-]+$/),
    sourceSha256: hash,
    sourceByteLength: integer.positive(),
    mode: z.enum(['CBR', 'VBR']),
    bitrates: z.array(z.number().int().positive().max(320)).min(1),
    frameCount: integer.positive(),
    virtual: virtualSchema.optional(),
  })
  .superRefine((entry, context) => {
    const v = entry.virtual
    if (
      (entry.mode === 'VBR') !== Boolean(v) ||
      (entry.mode === 'CBR') !== (new Set(entry.bitrates).size === 1) ||
      (v &&
        (v.byteLength !== v.headerByteLength + v.audioByteLength ||
          v.audioOffset + v.audioByteLength > entry.sourceByteLength))
    )
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent playback mapping',
      })
  })
export const playbackManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    generator: z.literal('PyAV 16.1.0 / libavformat 62.3.100'),
    entries: z.array(playbackEntrySchema),
  })
  .refine(
    (manifest) =>
      new Set(manifest.entries.map((entry) => entry.assetId)).size ===
      manifest.entries.length,
    'Duplicate playback asset',
  )

export type PlaybackEntry = z.infer<typeof playbackEntrySchema>
export type PlaybackManifest = z.infer<typeof playbackManifestSchema>
export interface PlaybackDescriptor {
  url: string
  mediaType: 'audio/mp4'
  codecs: 'mp4a.6B'
}

export function playbackPath(entry: PlaybackEntry) {
  return entry.virtual
    ? `/playback/${entry.sourceSha256}/${entry.virtual.sha256}.m4a`
    : null
}
