import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { readCatalog } from '../../server/content/repository.ts'
import { publicFeedArchive } from '../../server/content/feed.ts'
import { serializePodcastRss } from '../../server/rss/serialize.ts'
import { assertPodcastFeed } from './feed/assert.ts'
import { protectHistory } from './check.ts'
import { fileReader } from './files.ts'
import { createCandidate, readSources } from './source.ts'
import { isMain, parseArguments, runCli } from './cli.ts'

export async function checkFeed(
  args: string[],
  print: (message: string) => void = console.log,
  asOf = Date.now(),
) {
  const { output } = parseArguments(args, false)
  const current = await readCatalog(fileReader(resolve(output)), asOf)
  const original = createCandidate(await readSources())
  protectHistory(current.catalog, current.report, original)
  const archive = publicFeedArchive(current.catalog, asOf)
  const xml = serializePodcastRss(archive)
  const result = assertPodcastFeed(xml, archive)
  print(
    JSON.stringify(
      {
        valid: true,
        ...result,
        historicalItemsCompared: original.catalog.episodes.length,
        xmlByteLength: Buffer.byteLength(xml, 'utf8'),
        xmlSha256: createHash('sha256').update(xml, 'utf8').digest('hex'),
      },
      null,
      2,
    ),
  )
  return 0
}

if (isMain(import.meta.url))
  process.exitCode = await runCli(
    () => checkFeed(process.argv.slice(2)),
    console.error,
  )
