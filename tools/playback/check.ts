import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readCatalog } from '../../server/content/repository.ts'
import { fileReader } from '../content/files.ts'
import { validatePlayback, decodeHeader } from '../../server/playback/index.ts'
import { isMain, runCli } from '../content/cli.ts'

export async function checkPlayback(root = 'playback') {
  const { catalog } = await readCatalog(fileReader('content'))
  const manifest = validatePlayback(
    JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')),
    catalog.assets,
  )
  const expected = manifest.entries
    .flatMap((entry) => (entry.virtual ? [entry.virtual.sha256 + '.gz'] : []))
    .sort()
  if (
    JSON.stringify((await readdir(resolve(root, 'headers'))).sort()) !==
    JSON.stringify(expected)
  )
    throw new Error('Unexpected or missing playback headers')
  let compressedBytes = 0
  for (const entry of manifest.entries) {
    if (!entry.virtual) continue
    const bytes = await readFile(
      resolve(root, 'headers', entry.virtual.sha256 + '.gz'),
    )
    await decodeHeader(bytes, entry)
    compressedBytes += bytes.length
  }
  return {
    episodes: manifest.entries.length,
    virtual: expected.length,
    compressedBytes,
  }
}
if (isMain(import.meta.url))
  process.exitCode = await runCli(async () => {
    console.log(JSON.stringify(await checkPlayback()))
    return 0
  }, console.error)
