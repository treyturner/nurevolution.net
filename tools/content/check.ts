import { resolve } from 'node:path'
import type { Catalog, ImportReport } from '../../shared/content/schema.ts'
import { selectPublic } from '../../shared/content/public.ts'
import { readCatalog } from '../../server/content/repository.ts'
import { countCatalog } from '../../server/content/validate.ts'
import { isMain, parseArguments, runCli } from './cli.ts'
import { fileReader } from './files.ts'
import { createCandidate, jsonBytes, readSources } from './source.ts'

export function protectHistory(
  current: Catalog,
  report: ImportReport,
  original: ReturnType<typeof createCandidate>,
) {
  if (jsonBytes(report) !== jsonBytes(original.report))
    throw new Error(
      'wordpress-import.json: provenance changed; review a separate migration decision',
    )
  for (const before of original.catalog.episodes) {
    const after = current.episodes.find((e) => e.id === before.id)
    if (!after) throw new Error(`Missing historical episode: ${before.id}`)
    for (const key of [
      'id',
      'slug',
      'status',
      'guid',
      'guidIsPermalink',
      'publishedAt',
      'audioAssetId',
    ] as const) {
      if (after[key] !== before[key])
        throw new Error(
          `${before.id}: protected ${key} changed; review a separate migration decision`,
        )
    }
    const beforeAudio = original.catalog.assets.find(
      (a) => a.id === before.audioAssetId,
    )!
    const afterAudio = current.assets.find((a) => a.id === after.audioAssetId)
    for (const key of [
      'id',
      'url',
      'mediaType',
      'byteLength',
      'sha256',
    ] as const) {
      if (afterAudio?.[key] !== beforeAudio[key])
        throw new Error(`${before.id}: protected audio ${key} changed`)
    }
  }
  for (const entry of original.catalog.legacyUrls) {
    if (
      !current.legacyUrls.some(
        (e) => e.url === entry.url && e.episodeId === entry.episodeId,
      )
    )
      throw new Error(`Protected legacy URL changed: ${entry.url}`)
  }
}

export async function checkContent(
  args: string[],
  print: (message: string) => void = console.log,
  asOf = Date.now(),
) {
  const { output } = parseArguments(args, false)
  const current = await readCatalog(fileReader(resolve(output)), asOf)
  protectHistory(
    current.catalog,
    current.report,
    createCandidate(await readSources()),
  )
  const published = selectPublic(current.catalog, asOf).length
  print(
    JSON.stringify(
      { valid: true, ...countCatalog(current.catalog), published },
      null,
      2,
    ),
  )
  return 0
}

if (isMain(import.meta.url))
  process.exitCode = await runCli(
    () => checkContent(process.argv.slice(2)),
    console.error,
  )
