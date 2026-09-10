import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { execute, waitReady } from '../../tools/deploy/host.ts'
import {
  archiveConfigDigest,
  imageConfigDigest,
} from '../../tools/deploy/image-identity.ts'

// Small real registry roundtrip, run on both Engine storage backends in CI.
// No cloud credentials or application/media build is needed.
const prefix = 'nurevolution-identity-' + randomBytes(5).toString('hex')
const directory = resolve('.local', prefix)
const registry = prefix + '-registry'
const baseImage =
  'registry:3.1.1@sha256:1be55279f18a2fe1a74edf2664cac61c1bea305b7b4642dab412e7affdcb3e33'
const image = prefix + '-fixture'
const docker = (args: string[]) => execute('docker', args)
const references: string[] = []
let createdRegistry = false
await fs.mkdir(directory, { recursive: true })
try {
  await fs.writeFile(
    resolve(directory, 'Dockerfile'),
    'FROM scratch\nCOPY payload /payload\nLABEL net.nurevolution.identity-fixture=true\n',
  )
  await fs.writeFile(
    resolve(directory, 'payload'),
    'Original image identity regression fixture.\n',
  )
  await docker([
    'build',
    '--provenance=false',
    '--platform',
    'linux/amd64',
    '-t',
    image,
    directory,
  ])
  references.push(image)
  const expected = await imageConfigDigest(image, execute)
  const archive = resolve(directory, 'fixture.tar')
  await docker(['save', '--platform', 'linux/amd64', '-o', archive, image])
  assert.equal(await archiveConfigDigest(archive, execute), expected)
  await docker(['image', 'rm', image])
  await docker(['load', '-i', archive])
  assert.equal(await imageConfigDigest(image, execute), expected)

  await docker([
    'create',
    '--name',
    registry,
    '-p',
    '127.0.0.1::5000',
    '--tmpfs',
    '/var/lib/registry',
    '-e',
    'OTEL_TRACES_EXPORTER=none',
    baseImage,
  ])
  createdRegistry = true
  await docker(['start', registry])
  await waitReady(async () => {
    await docker([
      'exec',
      registry,
      'wget',
      '-q',
      '-O',
      '/dev/null',
      'http://127.0.0.1:5000/v2/',
    ])
  }, 30)
  const port = (await docker(['port', registry, '5000/tcp'])).split(':').at(-1)!
  const repository = '127.0.0.1:' + port + '/fixture'
  const tag = repository + ':tested'
  await docker(['tag', image, tag])
  references.push(tag)
  await docker(['push', tag])
  const digests = JSON.parse(
    await docker([
      'image',
      'inspect',
      '--format',
      '{{json .RepoDigests}}',
      tag,
    ]),
  ) as string[]
  const reference = digests.find((value) =>
    value.startsWith(repository + '@sha256:'),
  )
  assert.ok(reference)
  // Force a registry fetch after removing the local tested image and tag.
  await docker(['image', 'rm', tag, image])
  await docker(['pull', reference])
  references.push(reference)
  assert.equal(await imageConfigDigest(reference, execute), expected)
  const displayId = await docker([
    'image',
    'inspect',
    '--format',
    '{{.Id}}',
    reference,
  ])
  const storage = await docker(['info', '--format', '{{.DriverStatus}}'])
  if (storage.includes('io.containerd.snapshotter.v1'))
    assert.notEqual(displayId, expected)
  console.log(
    JSON.stringify({
      storage,
      saveLoadRegistryPull: 'passed',
      configurationDigest: expected,
      displayId,
    }),
  )
} finally {
  if (createdRegistry) await docker(['rm', '-f', '-v', registry])
  for (const reference of references.reverse())
    await docker(['image', 'rm', reference]).catch(() => {})
  await fs.rm(directory, { recursive: true, force: true })
}
