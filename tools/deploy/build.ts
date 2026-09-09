import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { readCatalog } from '../../server/content/repository.ts'
import { fileReader } from '../content/files.ts'
import { createCandidate, readSources } from '../content/source.ts'
import { createManifest, serialize, sha256 } from './manifest.ts'

export async function prepareBundle(
  output: string,
  commit: string,
  asOf: string,
) {
  const { catalog } = await readCatalog(fileReader('content'))
  const historical = createCandidate(await readSources()).catalog
  const manifest = createManifest(catalog, commit, asOf, historical.assets)
  const rendererHash = sha256(
    await fs.readFile('tools/deploy/render-config.ts'),
  )
  const configuration = {
    schemaVersion: 1 as const,
    sourceCommit: commit,
    compose: await fs.readFile('deploy/compose.yaml', 'utf8'),
    rendererSha256: rendererHash,
    caddyDockerfileSha256: sha256(await fs.readFile('deploy/Caddy.Dockerfile')),
  }
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(resolve(output, 'manifest.json'), serialize(manifest))
  await fs.writeFile(
    resolve(output, 'configuration.json'),
    serialize(configuration),
  )
  await fs.writeFile(resolve(output, 'renderer.sha256'), rendererHash + '\n')
  return { manifest, configuration }
}
