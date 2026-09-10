import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { commitSchema, serialize, sha256 } from './manifest.ts'
import { execute, type Execute } from './host.ts'
import { imageConfigDigest } from './image-identity.ts'
import {
  registry,
  readRelease,
  releaseSchema,
  configurationSchema,
  verifyTooling,
} from './release.ts'

const imageSchema = z.strictObject({
  sourceCommit: commitSchema,
  appTag: z.string().regex(/^nurevolution-delivery-[a-f0-9]{10}-app$/),
  caddyTag: z.string().regex(/^nurevolution-delivery-[a-f0-9]{10}-caddy$/),
  imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  caddyImageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  caddyBinarySha256: z.string().regex(/^[a-f0-9]{64}$/),
})

export async function publishImages(
  bundle: string,
  runId: string,
  context: {
    repository?: string
    ref?: string
    event?: string
    commit?: string
  },
  run: Execute = execute,
) {
  const images = imageSchema.parse(
    JSON.parse(await fs.readFile(resolve(bundle, 'images.json'), 'utf8')),
  )
  if (
    context.repository !== 'treyturner/nurevolution.net' ||
    context.ref !== 'refs/heads/main' ||
    context.event !== 'push' ||
    context.commit !== images.sourceCommit ||
    !/^[1-9][0-9]*$/.test(runId)
  )
    throw new Error('Image publication requires a trusted main push')
  const manifest = await fs.readFile(resolve(bundle, 'manifest.json'), 'utf8')
  const configuration = await fs.readFile(
    resolve(bundle, 'configuration.json'),
    'utf8',
  )
  await verifyTooling(
    resolve(bundle, 'deploy.mjs'),
    configurationSchema.parse(JSON.parse(configuration)).toolingSha256,
  )
  const digests: string[] = []
  for (const [file, tag, id, repository] of [
    ['runtime.tar', images.appTag, images.imageId, registry],
    ['caddy.tar', images.caddyTag, images.caddyImageId, registry + '-caddy'],
  ]) {
    await run('docker', ['load', '-i', resolve(bundle, file!)])
    if ((await imageConfigDigest(tag!, run, bundle)) !== id)
      throw new Error('Loaded image differs from verified image')
    const target = repository + ':' + images.sourceCommit
    await run('docker', ['tag', tag!, target])
    await run('docker', ['push', target])
    const references = JSON.parse(
      await run('docker', [
        'image',
        'inspect',
        '--format',
        '{{json .RepoDigests}}',
        target,
      ]),
    ) as string[]
    const reference = references.find((value) =>
      value.startsWith(repository + '@sha256:'),
    )
    if (!reference) throw new Error('Registry digest unavailable')
    digests.push(reference.slice(reference.indexOf('@') + 1))
  }
  const release = releaseSchema.parse({
    schemaVersion: 1,
    sourceCommit: images.sourceCommit,
    verifyRunUrl: `https://github.com/treyturner/nurevolution.net/actions/runs/${runId}`,
    imageDigest: digests[0],
    imageId: images.imageId,
    caddyImageDigest: digests[1],
    caddyImageId: images.caddyImageId,
    caddyBinarySha256: images.caddyBinarySha256,
    configurationSha256: sha256(configuration),
    mediaManifestSha256: sha256(manifest),
    publishedAt: new Date().toISOString(),
  })
  readRelease(release, manifest, configuration)
  await fs.writeFile(resolve(bundle, 'release.json'), serialize(release))
  return release
}
