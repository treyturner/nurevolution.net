import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { prepareBundle } from '../../../tools/deploy/build.ts'
import { publishImages } from '../../../tools/deploy/publish.ts'
import { backup } from '../../../tools/deploy/backup.ts'
import { serialize } from '../../../tools/deploy/manifest.ts'
import { releaseFixture } from './fixtures.ts'
import type { Execute } from '../../../tools/deploy/host.ts'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true })
})
async function directory() {
  const dir = await fs.mkdtemp(resolve(tmpdir(), 'nurevolution-bundle-'))
  directories.push(dir)
  return dir
}

it('packages all audited assets and hashes the exact delivery configuration', async () => {
  const dir = await directory()
  const { manifest, configuration } = await prepareBundle(
    dir,
    'a'.repeat(40),
    '2026-09-09T00:00:00.000Z',
  )
  expect(manifest.assets).toHaveLength(156)
  expect(manifest.assets.every((e) => e.public)).toBe(true)
  expect(await fs.readFile(resolve(dir, 'renderer.sha256'), 'utf8')).toBe(
    configuration.rendererSha256 + '\n',
  )
  expect(
    JSON.parse(await fs.readFile(resolve(dir, 'manifest.json'), 'utf8')),
  ).toEqual(manifest)
})

it('publishes only tested loaded images from a trusted main event and records registry digests', async () => {
  const dir = await directory(),
    f = releaseFixture()
  await fs.writeFile(
    resolve(dir, 'images.json'),
    serialize({
      sourceCommit: f.release.sourceCommit,
      appTag: 'nurevolution-delivery-1234567890-app',
      caddyTag: 'nurevolution-delivery-1234567890-caddy',
      imageId: f.release.imageId,
      caddyImageId: f.release.caddyImageId,
    }),
  )
  await fs.writeFile(
    resolve(dir, 'configuration.json'),
    serialize(f.configuration),
  )
  await fs.writeFile(resolve(dir, 'manifest.json'), serialize(f.manifest))
  const run = vi.fn<Execute>(async (_cmd, args) => {
    if (args.includes('{{.Id}}'))
      return args.at(-1)!.endsWith('-app')
        ? f.release.imageId
        : f.release.caddyImageId
    if (args.includes('{{json .RepoDigests}}'))
      return JSON.stringify([
        args.at(-1)!.split(':')[0] + '@' + f.release.imageDigest,
      ])
    return ''
  })
  const context = {
    repository: 'treyturner/nurevolution.net',
    ref: 'refs/heads/main',
    event: 'push',
    commit: f.release.sourceCommit,
  }
  const release = await publishImages(dir, '123', context, run)
  expect(release.imageId).toBe(f.release.imageId)
  expect(run.mock.calls.some(([, args]) => args.includes('build'))).toBe(false)
  for (const patch of [
    { repository: 'fork/repo' },
    { ref: 'refs/pull/4/merge' },
    { event: 'pull_request' },
    { commit: 'b'.repeat(40) },
  ])
    await expect(
      publishImages(dir, '123', { ...context, ...patch }, run),
    ).rejects.toThrow('trusted main')
  await expect(publishImages(dir, 'invalid', context, run)).rejects.toThrow()
  const original = run.getMockImplementation()!
  run.mockImplementation(async (cmd, args, env) =>
    args.includes('{{.Id}}') ? 'wrong' : original(cmd, args, env),
  )
  await expect(publishImages(dir, '123', context, run)).rejects.toThrow(
    'differs',
  )
  run.mockImplementation(async (cmd, args, env) =>
    args.includes('{{json .RepoDigests}}') ? '[]' : original(cmd, args, env),
  )
  await expect(publishImages(dir, '123', context, run)).rejects.toThrow(
    'digest unavailable',
  )
})

it('backs up under deployment locks, verifies the repository, and applies only the agreed retention', async () => {
  const dir = await directory(),
    edge = resolve(dir, 'edge')
  await fs.mkdir(resolve(dir, 'state'))
  await fs.mkdir(edge)
  const run = vi.fn<Execute>(async (_cmd, args) =>
    args[0] === 'version'
      ? 'restic 0.19.1 compiled with go'
      : args[0] === 'snapshots'
        ? '[{"id":"snapshot"}]'
        : '',
  )
  expect((await backup(dir, edge, run)).snapshotId).toBe('snapshot')
  expect(run.mock.calls.map(([, args]) => args[0])).toEqual([
    'version',
    'backup',
    'check',
    'forget',
    'snapshots',
  ])
  expect(run.mock.calls.find(([, args]) => args[0] === 'forget')![1]).toContain(
    '--keep-weekly',
  )
  run.mockResolvedValueOnce('restic 0.18')
  await expect(backup(dir, edge, run)).rejects.toThrow('pinned')
  const original = run.getMockImplementation()!
  run.mockImplementation(async (cmd, args, env) =>
    args[0] === 'snapshots' ? '[]' : original(cmd, args, env),
  )
  await expect(backup(dir, edge, run)).rejects.toThrow('snapshot')
})
