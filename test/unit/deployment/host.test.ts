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
import type { Profile } from '../../../tools/deploy/render-config.ts'
import {
  releaseFixture,
  imageConfiguration,
  imageArchiveCommands,
} from './fixtures.ts'
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
  const archive = imageArchiveCommands((image) =>
    imageConfiguration(
      image === record.release.caddyImageId
        ? 'caddy'
        : image.startsWith('ghcr.io/')
          ? 'app'
          : 'other',
    ),
  )
  const run = vi.fn<Execute>(async (command, args) => {
    const output = archive(command, args)
    if (output !== undefined) return output
    if (args[0] === 'inspect') return record.release.caddyImageId
    if (args[0] === 'image')
      return JSON.stringify([
        {
          Id: record.release.imageId,
          RepoDigests: [
            'ghcr.io/treyturner/nurevolution.net@' + record.release.imageDigest,
          ],
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
  const respond = async (
    input: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
    currentProfile: Pick<Profile, 'webOrigin' | 'mediaOrigin'>,
  ) => {
    const url = new URL(String(input))
    if (
      ![currentProfile.webOrigin, currentProfile.mediaOrigin].includes(
        url.origin,
      )
    )
      return new Response(null, { status: 404 })
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
  }
  const request = vi.fn<typeof fetch>(async (input, init) =>
    respond(
      input,
      init,
      JSON.parse(await fs.readFile(resolve(root, 'profile.json'), 'utf8')),
    ),
  )
  const paths = { root, edgeDirectory, edgeContainer: 'shared-edge' }
  return { root, paths, bundle, run, request, respond, record }
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
    (await fs.stat(resolve(f.root, 'state/production/current.json'))).mode &
      0o777,
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
  ).toContain('nurevolution-production:3000')
  await deployOnHost(f.bundle, f.paths, f.run, f.request)
  expect(
    await fs.readFile(
      resolve(f.root, 'state/production/previous.json'),
      'utf8',
    ),
  ).toContain(f.record.release.imageDigest)
})

it('accepts registry-pulled containerd images whose display IDs are manifest digests', async () => {
  const f = await fixture(),
    original = f.run.getMockImplementation()!
  const archive = imageArchiveCommands((ref) =>
    imageConfiguration(
      ref === f.record.release.caddyImageDigest ? 'caddy' : 'app',
    ),
  )
  f.run.mockImplementation(async (command, args, env, timeout, trim) => {
    const output = archive(command, args)
    if (output !== undefined) return output
    if (args.includes('{{.Image}}')) return f.record.release.caddyImageDigest
    const result = await original(command, args, env, timeout, trim)
    if (args[0] === 'image' && args[1] === 'inspect') {
      const [image] = JSON.parse(result)
      return JSON.stringify([{ ...image, Id: f.record.release.imageDigest }])
    }
    return result
  })
  await deployOnHost(f.bundle, f.paths, f.run, f.request)
  expect(f.run.mock.calls.some(([, args]) => args.includes('sha256sum'))).toBe(
    false,
  )
  expect(
    await fs.readFile(resolve(f.root, 'state/production/current.json'), 'utf8'),
  ).toContain(f.record.release.imageId)
})

it.each(['configuration', 'registry', 'revision'])(
  'rejects mismatched %s identity before stopping the app',
  async (kind) => {
    const f = await fixture(),
      original = f.run.getMockImplementation()!
    const archive = imageArchiveCommands((ref) =>
      imageConfiguration(ref.startsWith('ghcr.io/') ? 'wrong' : 'caddy'),
    )
    f.run.mockImplementation(async (command, args, env, timeout, trim) => {
      if (kind === 'configuration') {
        const output = archive(command, args)
        if (output !== undefined) return output
      }
      const result = await original(command, args, env, timeout, trim)
      if (args[0] === 'image' && args[1] === 'inspect') {
        const [image] = JSON.parse(result)
        if (kind === 'registry')
          image.RepoDigests = [
            'ghcr.io/other/app@' + f.record.release.imageDigest,
          ]
        if (kind === 'revision')
          image.Config.Labels['org.opencontainers.image.revision'] = 'b'.repeat(
            40,
          )
        return JSON.stringify([image])
      }
      return result
    })
    await expect(
      deployOnHost(f.bundle, f.paths, f.run, f.request),
    ).rejects.toThrow('Image identity mismatch')
    expect(f.run.mock.calls.some(([, args]) => args.includes('stop'))).toBe(
      false,
    )
  },
)

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
    args[0] === 'image' && args[1] === 'inspect'
      ? '[{"Id":"wrong"}]'
      : original(cmd, args, env),
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

it.each([false, true])(
  'keeps active Compose intact when host validation rejects a candidate (existing deployment: %s)',
  async (existing) => {
    const f = await fixture()
    if (existing) await deployOnHost(f.bundle, f.paths, f.run, f.request)
    const state = resolve(f.root, 'state/production')
    const composePath = resolve(state, 'compose.yaml')
    const acceptedCompose = existing
      ? await fs.readFile(composePath, 'utf8')
      : undefined
    const acceptedRecord = existing
      ? await fs.readFile(resolve(state, 'current.json'), 'utf8')
      : undefined
    const edgePath = resolve(f.paths.edgeDirectory, 'caddy.json')
    const acceptedEdge = await fs.readFile(edgePath, 'utf8')
    const validCompose = f.record.configuration.compose
    const setCompose = async (value: string) => {
      f.record.configuration.compose = value
      f.record.release.configurationSha256 = sha256(
        serialize(f.record.configuration),
      )
      for (const key of ['release', 'configuration'] as const)
        await fs.writeFile(
          resolve(f.bundle, key + '.json'),
          serialize(f.record[key]),
        )
    }
    const original = f.run.getMockImplementation()!
    f.run.mockClear()
    f.run.mockImplementation(async (command, args, env, timeout) => {
      if (args[0] === 'compose') {
        const file = args[args.indexOf('-f') + 1]!
        if ((await fs.readFile(file, 'utf8')) === 'host-incompatible compose')
          throw new Error('Host rejected candidate Compose')
        if (args.includes('stop') || args.includes('up'))
          await fs.access(resolve(state, 'pending.json'))
      }
      return original(command, args, env, timeout)
    })
    await setCompose('host-incompatible compose')
    await expect(
      deployOnHost(f.bundle, f.paths, f.run, f.request),
    ).rejects.toThrow('Host rejected candidate Compose')
    if (existing) {
      expect(await fs.readFile(composePath, 'utf8')).toBe(acceptedCompose)
      expect(await fs.readFile(resolve(state, 'current.json'), 'utf8')).toBe(
        acceptedRecord,
      )
    } else {
      await expect(fs.access(composePath)).rejects.toThrow()
      await expect(fs.access(resolve(state, 'current.json'))).rejects.toThrow()
    }
    expect(await fs.readFile(edgePath, 'utf8')).toBe(acceptedEdge)
    expect(f.run.mock.calls.some(([, args]) => args.includes('stop'))).toBe(
      false,
    )
    await expect(fs.access(resolve(state, 'pending.json'))).rejects.toThrow()
    await setCompose(validCompose)
    await deployOnHost(f.bundle, f.paths, f.run, f.request)
    expect(await fs.readFile(composePath, 'utf8')).toBe(validCompose)
  },
)

it.each(['webOrigin', 'mediaOrigin'] as const)(
  'accepts restored routes at their saved addresses after a %s change fails',
  async (origin) => {
    const f = await fixture()
    await deployOnHost(f.bundle, f.paths, f.run, f.request)
    const state = resolve(f.root, 'state/production')
    const accepted = await fs.readFile(resolve(state, 'current.json'), 'utf8')
    const edgePath = resolve(f.paths.edgeDirectory, 'caddy.json')
    const acceptedEdge = await fs.readFile(edgePath, 'utf8')
    const changedProfile = {
      ...profile,
      [origin]: 'https://changed-nurevolution.net',
      appMemoryMiB: 256,
    }
    // Different whitespace is allowed; the saved hash covers canonical profile data.
    await fs.writeFile(
      resolve(f.root, 'profile.json'),
      JSON.stringify(changedProfile),
    )
    f.request.mockClear()
    f.request.mockImplementation(async (input, init) => {
      const restored = (await fs.readFile(edgePath, 'utf8')) === acceptedEdge
      if (!restored && new URL(String(input)).pathname === '/feed/podcast')
        return new Response(null, { status: 503 })
      // Responses follow the active routes, independently of the edited profile file.
      return f.respond(input, init, restored ? profile : changedProfile)
    })
    await expect(
      deployOnHost(f.bundle, f.paths, f.run, f.request),
    ).rejects.toThrow('restored')
    expect(await fs.readFile(edgePath, 'utf8')).toBe(acceptedEdge)
    expect(await fs.readFile(resolve(state, 'current.json'), 'utf8')).toBe(
      accepted,
    )
    expect(
      JSON.parse(
        await fs.readFile(resolve(state, 'last-attempt.json'), 'utf8'),
      ),
    ).toMatchObject({ outcome: 'restored' })
    await expect(fs.access(resolve(state, 'pending.json'))).rejects.toThrow()
    expect(
      f.request.mock.calls.some(([input]) =>
        String(input).startsWith(profile.mediaOrigin),
      ),
    ).toBe(true)
    expect(
      f.run.mock.calls.filter(([, args]) => args.includes('up')).at(-1)?.[2],
    ).toMatchObject({
      WEB_ORIGIN: profile.webOrigin,
      MEDIA_ORIGIN: profile.mediaOrigin,
    })
    // A subsequent healthy attempt can still adopt the new origins and resource settings.
    f.request.mockImplementation((input, init) =>
      f.respond(input, init, changedProfile),
    )
    const deployed = await deployOnHost(f.bundle, f.paths, f.run, f.request)
    expect(deployed.profile).toEqual(changedProfile)
    expect(deployed.profileSha256).toBe(sha256(serialize(changedProfile)))
    expect(
      f.run.mock.calls.filter(([, args]) => args.includes('up')).at(-1)?.[2],
    ).toMatchObject({
      APP_MEMORY_MIB: '256',
      WEB_ORIGIN: changedProfile.webOrigin,
      MEDIA_ORIGIN: changedProfile.mediaOrigin,
    })
  },
)

it('restarts the prior release with its accepted memory limit after a reduced limit fails', async () => {
  const f = await fixture()
  await deployOnHost(f.bundle, f.paths, f.run, f.request)
  const current = resolve(f.root, 'state/production/current.json')
  const accepted = await fs.readFile(current, 'utf8')
  await fs.writeFile(
    resolve(f.root, 'profile.json'),
    serialize({ ...profile, appMemoryMiB: 128 }),
  )
  const original = f.run.getMockImplementation()!
  f.run.mockClear()
  f.run.mockImplementation(async (command, args, env, timeout) => {
    if (args.includes('up') && env?.APP_MEMORY_MIB === '128')
      throw new Error('Candidate OOM: insufficient memory limit')
    return original(command, args, env, timeout)
  })
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('restored')
  expect(
    f.run.mock.calls
      .filter(([, args]) => args.includes('up'))
      .map(([, , env]) => env?.APP_MEMORY_MIB),
  ).toEqual(['128', String(profile.appMemoryMiB)])
  expect(await fs.readFile(current, 'utf8')).toBe(accepted)
  await expect(
    fs.access(resolve(f.root, 'state/production/pending.json')),
  ).rejects.toThrow()
})

it.each(['missing', 'checksum', 'environment'])(
  'refuses %s saved profile data before changing the running deployment',
  async (failure) => {
    const f = await fixture()
    await deployOnHost(f.bundle, f.paths, f.run, f.request)
    const current = resolve(f.root, 'state/production/current.json')
    const saved = JSON.parse(await fs.readFile(current, 'utf8'))
    if (failure === 'missing') delete saved.profile
    else if (failure === 'checksum')
      saved.profile.webOrigin = 'https://wrong.nurevolution.net'
    else {
      saved.profile.environment = 'staging'
      saved.profileSha256 = sha256(serialize(saved.profile))
    }
    const bytes = serialize(saved)
    await fs.writeFile(current, bytes)
    const edgePath = resolve(f.paths.edgeDirectory, 'caddy.json')
    const acceptedEdge = await fs.readFile(edgePath, 'utf8')
    f.run.mockClear()
    f.request.mockClear()
    await expect(
      deployOnHost(f.bundle, f.paths, f.run, f.request),
    ).rejects.toThrow('Previous deployment profile missing or inconsistent')
    expect(f.run).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
    expect(await fs.readFile(current, 'utf8')).toBe(bytes)
    expect(await fs.readFile(edgePath, 'utf8')).toBe(acceptedEdge)
  },
)

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

it.each(['staging', 'development'])(
  'rejects an unsupported %s profile before touching accepted production',
  async (environment) => {
    const f = await fixture()
    await deployOnHost(f.bundle, f.paths, f.run, f.request)
    const currentPath = resolve(f.root, 'state/production/current.json')
    const current = await fs.readFile(currentPath, 'utf8')
    const edgePath = resolve(f.paths.edgeDirectory, 'caddy.json')
    const edge = await fs.readFile(edgePath, 'utf8')
    await fs.writeFile(
      resolve(f.root, 'profile.json'),
      serialize({ ...profile, environment }),
    )
    f.run.mockClear()
    f.request.mockClear()
    await expect(
      deployOnHost(f.bundle, f.paths, f.run, f.request),
    ).rejects.toThrow()
    expect(f.run).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
    expect(await fs.readFile(currentPath, 'utf8')).toBe(current)
    expect(await fs.readFile(edgePath, 'utf8')).toBe(edge)
    await expect(
      fs.access(resolve(f.root, 'state/production/pending.json')),
    ).rejects.toThrow()
  },
)

it('blocks promotion while an orphan journal or unscoped state remains', async () => {
  const f = await fixture()
  await fs.mkdir(resolve(f.root, 'state/retired'), { recursive: true })
  await fs.writeFile(resolve(f.root, 'state/retired/pending.json'), '{}')
  await expect(
    deployOnHost(f.bundle, f.paths, f.run, f.request),
  ).rejects.toThrow('Unrecovered')
  await fs.unlink(resolve(f.root, 'state/retired/pending.json'))
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
      fs.access(resolve(f.root, 'state/production/current.json')),
    ).rejects.toThrow()
    await deployOnHost(f.bundle, f.paths, f.run, f.request)
    const accepted = await fs.readFile(
      resolve(f.root, 'state/production/current.json'),
      'utf8',
    )
    fail = true
    await expect(
      deployOnHost(f.bundle, f.paths, f.run, f.request),
    ).rejects.toThrow('restored')
    expect(
      await fs.readFile(
        resolve(f.root, 'state/production/current.json'),
        'utf8',
      ),
    ).toBe(accepted)
  },
  // Three real, fsync-backed transactions need headroom for CI disk latency.
  30_000,
)
