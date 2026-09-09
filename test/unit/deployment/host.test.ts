import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  deployOnHost,
  execute,
  waitReady,
  memoryMiB,
  type Execute,
} from '../../../tools/deploy/host.ts'
import { serialize } from '../../../tools/deploy/manifest.ts'
import { releaseFixture } from './fixtures.ts'
import profile from '../../../deploy/profile.example.json'
import edge from '../../../deploy/caddy/initial.example.json'

vi.mock('../../../tools/deploy/stage-assets.ts', () => ({
  checkAssets: vi.fn(async () => ({ files: 156 })),
}))
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})
async function fixture() {
  const root = await fs.mkdtemp(resolve(tmpdir(), 'nurevolution-host-'))
  directories.push(root)
  const edgeDirectory = resolve(root, 'edge'),
    bundle = resolve(root, 'bundle')
  for (const dir of [edgeDirectory, bundle, resolve(root, 'tooling')])
    await fs.mkdir(dir)
  const record = releaseFixture()
  for (const key of ['release', 'configuration', 'manifest'] as const)
    await fs.writeFile(resolve(bundle, key + '.json'), serialize(record[key]))
  await fs.writeFile(resolve(root, 'profile.json'), serialize(profile))
  await fs.writeFile(
    resolve(root, 'tooling/renderer.sha256'),
    record.configuration.rendererSha256,
  )
  await fs.writeFile(resolve(edgeDirectory, 'caddy.json'), serialize(edge))
  const run = vi.fn<Execute>(async (_command, args) => {
    if (args[0] === 'inspect') return record.release.caddyImageId
    if (args[0] === 'image')
      return JSON.stringify([
        {
          Id: record.release.imageId,
          Config: {
            Labels: {
              'org.opencontainers.image.revision': record.release.sourceCommit,
            },
          },
        },
      ])
    if (args.includes('ps')) return 'app-container'
    if (args[0] === 'stats') return '128MiB / 384MiB'
    return ''
  })
  const request = vi.fn<typeof fetch>(
    async (url) =>
      new Response(
        String(url).endsWith('/api/health')
          ? JSON.stringify({ release: record.release.sourceCommit })
          : 'ok',
      ),
  )
  const paths = { root, edgeDirectory, edgeContainer: 'shared-edge' }
  return { root, paths, bundle, run, request, record }
}

it('runs bounded commands and waits through transient readiness failures', async () => {
  expect(memoryMiB('0.125GiB / 384MiB')).toBe(128)
  expect(memoryMiB('1024KiB / 384MiB')).toBe(1)
  expect(memoryMiB('1048576B / 384MiB')).toBe(1)
  await expect(
    Promise.resolve().then(() => memoryMiB('unknown')),
  ).rejects.toThrow('measure')
  expect(
    await execute(
      process.execPath,
      ['-e', 'process.stdout.write(process.env.M5_TEST!)'],
      { M5_TEST: 'ok' },
    ),
  ).toBe('ok')
  await expect(
    execute(process.execPath, ['-e', 'process.exit(2)']),
  ).rejects.toThrow()
  const check = vi
    .fn()
    .mockRejectedValueOnce(new Error('starting'))
    .mockResolvedValue(undefined)
  await waitReady(check, 1, async () => {})
  expect(check).toHaveBeenCalledTimes(2)
  await expect(
    waitReady(
      async () => {
        throw new Error('failed')
      },
      0,
      async () => {},
    ),
  ).rejects.toThrow('deadline')
})

it('validates/pulls the exact image and deploys only the owned app and site route', async () => {
  const f = await fixture()
  await deployOnHost(f.bundle, f.paths, f.run, f.request)
  expect(
    f.run.mock.calls.some(
      ([, args]) =>
        args.includes('pull') &&
        args.includes(
          'ghcr.io/treyturner/nurevolution.net@' + f.record.release.imageDigest,
        ),
    ),
  ).toBe(true)
  expect(
    f.run.mock.calls
      .filter(([, args]) => args.includes('stop'))
      .every(([, args]) => args.at(-1) === 'app'),
  ).toBe(true)
  expect(f.run.mock.calls.some(([, args]) => args.includes('down'))).toBe(false)
  expect(
    await fs.readFile(resolve(f.paths.edgeDirectory, 'caddy.json'), 'utf8'),
  ).toContain('nurevolution-preview:3000')
  await deployOnHost(f.bundle, f.paths, f.run, f.request)
  expect(
    await fs.readFile(resolve(f.root, 'state/previous.json'), 'utf8'),
  ).toContain(f.record.release.imageDigest)
})

it('refuses missing/invalid host configuration, stale journals, and mismatched images before stop', async () => {
  const f = await fixture()
  await expect(
    deployOnHost(
      f.bundle,
      { ...f.paths, edgeContainer: 'bad;command' },
      f.run,
      f.request,
    ),
  ).rejects.toThrow('Invalid edge')
  await fs.writeFile(resolve(f.root, 'tooling/renderer.sha256'), 'wrong')
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('tooling')
  await fs.writeFile(
    resolve(f.root, 'tooling/renderer.sha256'),
    f.record.configuration.rendererSha256,
  )
  await fs.writeFile(resolve(f.root, 'state/pending.json'), '{}')
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('Unrecovered')
  await fs.unlink(resolve(f.root, 'state/pending.json'))
  const original = f.run.getMockImplementation()!
  f.run.mockImplementation(async (cmd, args, env) =>
    args[0] === 'inspect' ? 'wrong' : original(cmd, args, env),
  )
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('Shared edge')
  f.run.mockImplementation(async (cmd, args, env) =>
    args[0] === 'image' ? '[{"Id":"wrong"}]' : original(cmd, args, env),
  )
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('Image identity')
  expect(f.run.mock.calls.some(([, args]) => args.includes('stop'))).toBe(false)
})

it('restores the prior edge/app when HTTPS acceptance or startup fails', async () => {
  const f = await fixture()
  await deployOnHost(f.bundle, f.paths, f.run, f.request)
  f.request.mockResolvedValueOnce(new Response('failed', { status: 503 }))
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('restored')
  f.request.mockResolvedValueOnce(new Response('{"release":"wrong"}'))
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('restored')
  const original = f.run.getMockImplementation()!
  let lookups = 0
  f.run.mockImplementation(async (cmd, args, env) => {
    if (args.includes('ps') && ++lookups === 2) {
      return ''
    }
    return original(cmd, args, env)
  })
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('restored')
})
