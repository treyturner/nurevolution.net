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
import { serialize, sha256 } from '../../../tools/deploy/manifest.ts'
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
  const tooling = await fs.readFile(
    new URL('../../../tools/deploy/host.ts', import.meta.url),
  )
  record.configuration.toolingSha256 = sha256(tooling)
  record.release.configurationSha256 = sha256(serialize(record.configuration))
  await fs.writeFile(resolve(root, 'tooling/deploy.mjs'), tooling)
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
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input))
    const currentProfile = JSON.parse(
      await fs.readFile(resolve(root, 'profile.json'), 'utf8'),
    )
    if (
      url.origin === currentProfile.webOrigin &&
      url.pathname.startsWith('/downloads/')
    )
      return new Response(null, {
        status: 307,
        headers: { location: currentProfile.mediaOrigin + url.pathname },
      })
    const entry = record.manifest.assets.find(
      (item) =>
        new URL(item.asset.url).pathname === url.pathname ||
        item.downloads.some(
          (download) => '/downloads/' + download.slug === url.pathname,
        ),
    )
    if (entry) {
      const download = entry.downloads.find(
        (item) => '/downloads/' + item.slug === url.pathname,
      )
      const headers: Record<string, string> = {
        'content-length': String(entry.asset.byteLength),
        'content-type': download
          ? 'application/octet-stream'
          : entry.asset.mediaType,
      }
      if (download) headers['content-disposition'] = download.disposition
      if (init?.method === 'HEAD') return new Response(null, { headers })
      const length = Math.min(1024, entry.asset.byteLength)
      return new Response(new Uint8Array(length), {
        status: 206,
        headers: {
          ...headers,
          'content-length': String(length),
          'content-range': `bytes 0-${length - 1}/${entry.asset.byteLength}`,
        },
      })
    }
    return new Response(
      url.pathname === '/api/health'
        ? JSON.stringify({ release: record.release.sourceCommit })
        : 'ok',
    )
  })
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
  for (const name of ['candidate.json', 'caddy.json'])
    expect(
      (await fs.stat(resolve(f.paths.edgeDirectory, name))).mode & 0o777,
    ).toBe(0o644)
  expect(
    (await fs.stat(resolve(f.root, 'state/preview/current.json'))).mode & 0o777,
  ).toBe(0o600)
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
    await fs.readFile(resolve(f.root, 'state/preview/previous.json'), 'utf8'),
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

it('keeps an independently rebuilt edge when its tested binary and pinned build policy match', async () => {
  const f = await fixture(),
    original = f.run.getMockImplementation()!
  let hash = f.record.release.caddyBinarySha256
  f.run.mockImplementation(async (cmd, args, env) => {
    if (args.includes('{{.Image}}')) return 'independently-built-image'
    if (args.some((arg) => arg.includes('net.nurevolution.caddy-policy')))
      return f.record.configuration.caddyDockerfileSha256
    if (args.includes('sha256sum')) return hash + '  /usr/bin/caddy'
    return original(cmd, args, env)
  })
  await deployOnHost(f.bundle, f.paths, f.run, f.request)
  hash = 'wrong'
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('binary/build policy')
})

it('keeps preview rollback state separate when the first production deployment fails', async () => {
  const f = await fixture()
  await deployOnHost(f.bundle, f.paths, f.run, f.request)
  const previewState = await fs.readFile(
    resolve(f.root, 'state/preview/current.json'),
    'utf8',
  )
  await fs.writeFile(
    resolve(f.root, 'profile.json'),
    serialize({
      ...profile,
      environment: 'production',
      webOrigin: 'https://nurevolution.net',
      mediaOrigin: 'https://podcast.nurevolution.net',
    }),
  )
  f.run.mockClear()
  f.request.mockResolvedValueOnce(new Response('failed', { status: 503 }))
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('undeployed')
  expect(
    await fs.readFile(resolve(f.root, 'state/preview/current.json'), 'utf8'),
  ).toBe(previewState)
  expect(
    JSON.parse(
      await fs.readFile(
        resolve(f.root, 'state/production/last-attempt.json'),
        'utf8',
      ),
    ),
  ).toMatchObject({ outcome: 'undeployed', previous: null })
  expect(
    f.run.mock.calls.filter(([, args]) => args.includes('up')),
  ).toHaveLength(1)
  expect(
    f.run.mock.calls
      .filter(([, args]) => args[0] === 'compose')
      .every(([, args]) => args.includes('nurevolution-production')),
  ).toBe(true)
  await expect(
    fs.access(resolve(f.root, 'state/production/current.json')),
  ).rejects.toThrow()
})

it('blocks a different environment while an interrupted journal or unscoped state remains', async () => {
  const f = await fixture()
  await fs.mkdir(resolve(f.root, 'state/production'), { recursive: true })
  await fs.writeFile(resolve(f.root, 'state/production/pending.json'), '{}')
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('Unrecovered')
  await fs.unlink(resolve(f.root, 'state/production/pending.json'))
  await fs.writeFile(resolve(f.root, 'state/current.json'), '{}')
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('Unscoped')
  expect(f.run).not.toHaveBeenCalled()
})

it('rejects stale executable bytes even when the renderer fingerprint matches', async () => {
  const f = await fixture()
  await fs.writeFile(
    resolve(f.root, 'tooling/deploy.mjs'),
    'changed executable',
  )
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('tooling checksum')
  // Matching the installed file is insufficient if a different bundle is running.
  f.record.configuration.toolingSha256 = sha256('changed executable')
  f.record.release.configurationSha256 = sha256(
    serialize(f.record.configuration),
  )
  await fs.writeFile(
    resolve(f.bundle, 'configuration.json'),
    serialize(f.record.configuration),
  )
  await fs.writeFile(
    resolve(f.bundle, 'release.json'),
    serialize(f.record.release),
  )
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('tooling checksum')
  expect(f.run).not.toHaveBeenCalled()
})

it.each(['head', 'range', 'attachment', 'tls'])(
  'rejects broken media %s before accepting a first deployment and rolls back an update',
  async (failure) => {
    const f = await fixture()
    const original = f.request.getMockImplementation()!
    let fail = true
    f.request.mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      const matches =
        url.origin === profile.mediaOrigin &&
        (failure === 'tls' ||
          (failure === 'head' &&
            init?.method === 'HEAD' &&
            !url.pathname.startsWith('/downloads/')) ||
          (failure === 'range' && new Headers(init?.headers).has('Range')) ||
          (failure === 'attachment' && url.pathname.startsWith('/downloads/')))
      if (fail && matches) {
        fail = false
        if (failure === 'tls') throw new Error('Media TLS failure')
        return new Response(null, { status: 404 })
      }
      return original(input, init)
    })
    await expect(
      deployOnHost(f.bundle, f.paths, f.run, f.request),
    ).rejects.toThrow('undeployed')
    await expect(
      fs.access(resolve(f.root, 'state/preview/current.json')),
    ).rejects.toThrow()
    await deployOnHost(f.bundle, f.paths, f.run, f.request)
    const accepted = await fs.readFile(
      resolve(f.root, 'state/preview/current.json'),
      'utf8',
    )
    fail = true
    await expect(
      deployOnHost(f.bundle, f.paths, f.run, f.request),
    ).rejects.toThrow('restored')
    expect(
      await fs.readFile(resolve(f.root, 'state/preview/current.json'), 'utf8'),
    ).toBe(accepted)
  },
)
