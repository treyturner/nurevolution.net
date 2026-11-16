import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  deployRelease,
  reconcileFallback,
  type DeploymentDriver,
} from '../../../tools/deploy/deploy.ts'
import {
  effectiveManifest,
  publicationRelease,
  type DeploymentRecord,
} from '../../../tools/deploy/release.ts'
import {
  createManifest,
  serialize,
  sha256,
} from '../../../tools/deploy/manifest.ts'
import { prepareBundle } from '../../../tools/deploy/build.ts'
import { verifyPublication } from '../../../tools/deploy/publication.ts'
import { runnableCatalog } from '../content/fixtures.ts'
import { releaseFixture, fixtureTooling } from './fixtures.ts'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true })
})
async function directory() {
  const path = await fs.mkdtemp(resolve(tmpdir(), 'publication-'))
  directories.push(path)
  return path
}
function records() {
  const candidate: DeploymentRecord = releaseFixture()
  candidate.configuration.publication = {
    version: 1,
    files: [{ path: 'content/show.json', sha256: '1'.repeat(64) }],
  }
  const previous = structuredClone(candidate)
  const catalog = runnableCatalog()
  catalog.episodes.shift()
  previous.manifest = createManifest(
    catalog,
    'b'.repeat(40),
    candidate.manifest.asOf,
  )
  previous.release.sourceCommit = previous.configuration.sourceCommit =
    previous.manifest.sourceCommit
  previous.release.imageDigest = 'sha256:' + '9'.repeat(64)
  for (const r of [candidate, previous]) {
    r.release.configurationSha256 = sha256(serialize(r.configuration))
    r.release.mediaManifestSha256 = sha256(serialize(r.manifest))
  }
  return { candidate, previous }
}
function driver(): DeploymentDriver {
  return {
    preflight: vi.fn(),
    prepare: vi.fn(),
    prepareFallback: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    ready: vi.fn(),
    activate: vi.fn(),
    accept: vi.fn(),
    restoreEdge: vi.fn(),
  }
}

it('publishes an added episode while retaining older code with the current catalog as the fallback', async () => {
  const { candidate, previous } = records()
  const root = await directory(),
    d = driver()
  await deployRelease(root, candidate, previous, d)
  const fallback = JSON.parse(
    await fs.readFile(resolve(root, 'previous.json'), 'utf8'),
  ) as DeploymentRecord
  expect(fallback.release).toEqual(previous.release)
  expect(fallback.configuration).toEqual(previous.configuration)
  expect(fallback.manifest).toEqual(previous.manifest)
  expect(fallback.publication).toEqual(publicationRelease(candidate))
  expect(effectiveManifest(fallback).episodes).toEqual(
    candidate.manifest.episodes,
  )
  expect(d.prepareFallback).toHaveBeenCalledWith(fallback)
  expect(
    vi.mocked(d.prepareFallback!).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(d.stop).mock.invocationCallOrder[0]!)
  // Explicit code rollback keeps the most recently published subscriber set.
  await deployRelease(root, fallback, candidate, d)
  expect(
    JSON.parse(await fs.readFile(resolve(root, 'current.json'), 'utf8')),
  ).toEqual(fallback)
})

it('recovers a failed publication with older code and the new catalog, including edge mappings', async () => {
  const { candidate, previous } = records()
  const root = await directory(),
    d = driver()
  vi.mocked(d.accept).mockRejectedValueOnce(
    new Error('HTTPS failed after activation'),
  )
  await expect(deployRelease(root, candidate, previous, d)).rejects.toThrow(
    'restored',
  )
  const recovered = JSON.parse(
    await fs.readFile(resolve(root, 'current.json'), 'utf8'),
  ) as DeploymentRecord
  expect(recovered.release).toEqual(previous.release)
  expect(effectiveManifest(recovered)).toEqual(candidate.manifest)
  expect(d.restoreEdge).toHaveBeenCalledWith(recovered)
  expect(vi.mocked(d.start).mock.calls.at(-1)?.[0]).toEqual(recovered)
  expect(
    JSON.parse(await fs.readFile(resolve(root, 'last-attempt.json'), 'utf8'))
      .outcome,
  ).toBe('restored')
})

it('stops before interruption when the reconciled fallback cannot be verified', async () => {
  const { candidate, previous } = records()
  const root = await directory(),
    d = driver()
  vi.mocked(d.prepareFallback!).mockRejectedValueOnce(
    new Error('missing artwork'),
  )
  await expect(deployRelease(root, candidate, previous, d)).rejects.toThrow(
    'missing artwork',
  )
  expect(d.stop).not.toHaveBeenCalled()
  await expect(fs.stat(resolve(root, 'pending.json'))).rejects.toThrow()
  delete d.prepareFallback
  await expect(deployRelease(root, candidate, previous, d)).rejects.toThrow(
    'must be verified',
  )
  expect(d.stop).not.toHaveBeenCalled()
})

it('requires a support release and still rejects withdrawal and identity changes', () => {
  const { candidate, previous } = records()
  const legacy = structuredClone(previous)
  delete legacy.configuration.publication
  expect(() => reconcileFallback(candidate, legacy)).toThrow('withdraw')
  expect(() => reconcileFallback(previous, candidate)).toThrow('withdraw')
  const changed = structuredClone(candidate)
  changed.manifest.episodes.at(-1)!.guid = 'changed-guid'
  expect(() => reconcileFallback(changed, previous)).toThrow('identity')
})

it('verifies exact snapshot bytes, coverage, catalog identity, and playback before use', async () => {
  const root = await directory()
  await fs.writeFile(resolve(root, 'deploy.mjs'), fixtureTooling)
  const snapshot = resolve(root, 'snapshot')
  const bundle = await prepareBundle(
    root,
    'a'.repeat(40),
    new Date().toISOString(),
    snapshot,
  )
  const r = releaseFixture()
  const publication = {
    ...bundle,
    release: {
      ...r.release,
      mediaManifestSha256: sha256(serialize(bundle.manifest)),
      configurationSha256: sha256(serialize(bundle.configuration)),
    },
  }
  await verifyPublication(snapshot, publication)
  const file = resolve(snapshot, 'content/show.json')
  const bytes = await fs.readFile(file)
  await fs.writeFile(file, '{}')
  await expect(verifyPublication(snapshot, publication)).rejects.toThrow(
    'checksum',
  )
  await fs.writeFile(file, bytes)
  await fs.writeFile(resolve(snapshot, 'extra.json'), '{}')
  await expect(verifyPublication(snapshot, publication)).rejects.toThrow(
    'Incomplete',
  )
  await fs.unlink(resolve(snapshot, 'extra.json'))
  const changed = structuredClone(publication)
  changed.manifest.episodes[0]!.guid = 'altered-guid'
  changed.release.mediaManifestSha256 = sha256(serialize(changed.manifest))
  await expect(verifyPublication(snapshot, changed)).rejects.toThrow(
    'catalog differs',
  )
  await fs.unlink(file)
  await fs.symlink(resolve('content/show.json'), file)
  await expect(verifyPublication(snapshot, publication)).rejects.toThrow(
    'Unsupported',
  )
})
