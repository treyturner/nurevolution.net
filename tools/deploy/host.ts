import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { assertNoSymlinks } from '../content/files.ts'
import { checkAssets } from './stage-assets.ts'
import { checkMediaHttp } from './check-media.ts'
import { imageConfigDigest } from './image-identity.ts'
import {
  atomicWrite,
  deployRelease,
  syncDirectory,
  withLock,
  type DeploymentDriver,
} from './deploy.ts'
import {
  expectedImages,
  readRelease,
  verifyTooling,
  type DeploymentRecord,
} from './release.ts'
import {
  profileSchema,
  renderSite,
  replaceSite,
  type JsonObject,
} from './render-config.ts'
import { serialize, sha256 } from './manifest.ts'

export type Execute = (
  command: string,
  args: string[],
  env?: Record<string, string>,
  timeoutMs?: number,
  trimOutput?: boolean,
) => Promise<string>
const exec = promisify(execFile)
export const execute: Execute = async (
  command,
  args,
  env,
  timeoutMs = 300_000,
  trimOutput = true,
) => {
  const { stdout } = await exec(command, args, {
    env: { ...process.env, ...env },
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  })
  return trimOutput ? stdout.trim() : stdout
}

export async function waitReady(
  check: () => Promise<void>,
  seconds: number,
  pause: (milliseconds: number) => Promise<unknown> = delay,
) {
  const deadline = Date.now() + seconds * 1000
  let last: unknown
  do {
    try {
      await check()
      return
    } catch (error) {
      last = error
    }
    await pause(250)
  } while (Date.now() < deadline)
  throw new Error('Readiness deadline exceeded', { cause: last })
}

export interface HostPaths {
  root: string
  edgeDirectory: string
  edgeContainer: string
}

export function memoryMiB(value: string) {
  const match = /^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB)\s*\//.exec(value)
  if (!match) throw new Error('Cannot measure current application memory')
  return (
    Number(match[1]) *
    (
      { B: 1 / 1024 ** 2, KiB: 1 / 1024, MiB: 1, GiB: 1024 } as Record<
        string,
        number
      >
    )[match[2]!]!
  )
}
export async function deployOnHost(
  bundle: string,
  paths: HostPaths,
  run: Execute = execute,
  request: typeof fetch = fetch,
) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(paths.edgeContainer))
    throw new Error('Invalid edge container')
  await assertNoSymlinks(paths.root)
  await assertNoSymlinks(paths.edgeDirectory)
  await assertNoSymlinks(bundle)
  const stateRoot = resolve(paths.root, 'state')
  await fs.mkdir(stateRoot, { recursive: true })
  await syncDirectory(paths.root)
  return withLock(resolve(stateRoot, 'deploy.lock'), () =>
    withLock(resolve(paths.edgeDirectory, 'deploy.lock'), async () => {
      for (const directory of [
        stateRoot,
        resolve(stateRoot, 'preview'),
        resolve(stateRoot, 'production'),
      ]) {
        try {
          await fs.access(resolve(directory, 'pending.json'))
          throw new Error('Unrecovered deployment journal')
        } catch (error) {
          if (!(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          ))
            throw error
        }
      }
      const legacyState = await fs.readdir(stateRoot)
      if (
        legacyState.includes('current.json') ||
        legacyState.includes('previous.json')
      )
        throw new Error(
          'Unscoped deployment state; reconcile its environment before promotion',
        )
      const profileBytes = await fs.readFile(
        resolve(paths.root, 'profile.json'),
        'utf8',
      )
      const profile = profileSchema.parse(JSON.parse(profileBytes))
      if (profile.environment === 'preview') {
        // The 1 GB host has one app/route slot. A preview must never replace
        // canonical production traffic, including through the direct CLI.
        for (const path of [
          resolve(paths.root, 'production-enabled'),
          resolve(stateRoot, 'production/current.json'),
        ]) {
          try {
            await fs.lstat(path)
            throw new Error(
              'Preview deployment is disabled once production is enabled or recorded; reconcile cutover before reusing the shared slot',
            )
          } catch (error) {
            if (!(
              error instanceof Error &&
              'code' in error &&
              error.code === 'ENOENT'
            ))
              throw error
          }
        }
      }
      const state = resolve(stateRoot, profile.environment)
      await fs.mkdir(state, { recursive: true })
      await syncDirectory(stateRoot)
      const manifestBytes = await fs.readFile(
        resolve(bundle, 'manifest.json'),
        'utf8',
      )
      const configBytes = await fs.readFile(
        resolve(bundle, 'configuration.json'),
        'utf8',
      )
      const { record, manifest, configuration } = readRelease(
        JSON.parse(await fs.readFile(resolve(bundle, 'release.json'), 'utf8')),
        manifestBytes,
        configBytes,
      )
      // Bind both the installed file and the executing bundle to the tested
      // executable; a renderer-only hash cannot identify host/recovery changes.
      await verifyTooling(
        resolve(paths.root, 'tooling/deploy.mjs'),
        configuration.toolingSha256,
      )
      await verifyTooling(
        fileURLToPath(import.meta.url),
        configuration.toolingSha256,
      )
      const renderer = await fs.readFile(
        resolve(paths.root, 'tooling/renderer.sha256'),
        'utf8',
      )
      if (renderer.trim() !== configuration.rendererSha256)
        throw new Error('Install the verified release tooling before promotion')
      const edgePath = resolve(paths.edgeDirectory, 'caddy.json')
      const edgeBytes = await fs.readFile(edgePath, 'utf8')
      const edge = JSON.parse(edgeBytes) as JsonObject
      const rendered = replaceSite(edge, renderSite(manifest, profile))
      const candidate: DeploymentRecord = {
        release: record,
        manifest,
        configuration,
        profile,
        profileSha256: sha256(serialize(profile)),
        edgeSha256: sha256(serialize(rendered)),
        deployedAt: new Date().toISOString(),
      }
      let previous: DeploymentRecord | undefined
      try {
        previous = JSON.parse(
          await fs.readFile(resolve(state, 'current.json'), 'utf8'),
        ) as DeploymentRecord
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error
      }
      if (previous) {
        readRelease(
          previous.release,
          serialize(previous.manifest),
          serialize(previous.configuration),
        )
        const savedProfile = profileSchema.safeParse(previous.profile)
        if (
          !savedProfile.success ||
          sha256(serialize(savedProfile.data)) !== previous.profileSha256 ||
          savedProfile.data.environment !== profile.environment
        )
          throw new Error(
            'Previous deployment profile missing or inconsistent; reconcile saved state before promotion',
          )
      }
      const project = `nurevolution-${profile.environment}`
      const composePath = resolve(state, 'compose.yaml')
      const candidateComposePath = resolve(state, 'candidate.compose.yaml')
      const environment = (r: DeploymentRecord) => ({
        APP_IMAGE: expectedImages(r.release).app,
        APP_MEMORY_MIB: String(r.profile.appMemoryMiB),
        DEPLOY_ENVIRONMENT: r.profile.environment,
      })
      const compose = (
        r: DeploymentRecord,
        args: string[],
        file = composePath,
      ) =>
        run(
          'docker',
          ['compose', '-p', project, '-f', file, ...args],
          environment(r),
        )
      const appId = async () =>
        (await compose(candidate, ['ps', '-aq', 'app'])).trim()
      const edgeCommand = (args: string[]) =>
        run('docker', ['exec', paths.edgeContainer, 'caddy', ...args])
      const activate = async (bytes: string) => {
        await atomicWrite(edgePath, bytes, 0o644)
        await edgeCommand(['reload', '--config', '/etc/caddy/caddy.json'])
      }
      const driver: DeploymentDriver = {
        async preflight() {
          const mem = await fs.readFile('/proc/meminfo', 'utf8')
          const availableMiB =
            Number(/MemAvailable:\s+(\d+)/.exec(mem)?.[1]) / 1024
          const current = previous ? await appId() : ''
          const reclaimableMiB = current
            ? memoryMiB(
                await run('docker', [
                  'stats',
                  '--no-stream',
                  '--format',
                  '{{.MemUsage}}',
                  current,
                ]),
              )
            : 0
          if (
            !(
              availableMiB + reclaimableMiB >=
              Math.max(
                profile.reserveMemoryMiB + profile.appMemoryMiB,
                previous
                  ? previous.profile.reserveMemoryMiB +
                      previous.profile.appMemoryMiB
                  : 0,
              )
            )
          )
            throw new Error(
              'Insufficient memory headroom; measure/reduce other workloads before deployment',
            )
          const disk = await fs.statfs(paths.root)
          if (disk.bavail * disk.bsize < profile.minimumFreeDiskMiB * 1024 ** 2)
            throw new Error('Insufficient disk headroom')
          await checkAssets(manifest, resolve(paths.root, 'media'))
          await fs.mkdir(resolve(paths.root, 'releases'), { recursive: true })
          const edgeId = await run('docker', [
            'inspect',
            '--format',
            '{{.Image}}',
            paths.edgeContainer,
          ])
          if ((await imageConfigDigest(edgeId, run)) !== record.caddyImageId) {
            const policy = await run('docker', [
              'inspect',
              '--format',
              '{{index .Config.Labels "net.nurevolution.caddy-policy"}}',
              paths.edgeContainer,
            ])
            const binary = await run('docker', [
              'exec',
              paths.edgeContainer,
              'sha256sum',
              '/usr/bin/caddy',
            ])
            if (
              policy !== configuration.caddyDockerfileSha256 ||
              binary.split(/\s+/)[0] !== record.caddyBinarySha256
            )
              throw new Error(
                'Shared edge differs from the verified Caddy binary/build policy; reconcile separately',
              )
          }
        },
        async prepare() {
          await run('docker', ['pull', expectedImages(record).app])
          const image = JSON.parse(
            await run('docker', [
              'image',
              'inspect',
              expectedImages(record).app,
            ]),
          ) as {
            RepoDigests?: string[]
            Config?: { Labels?: Record<string, string> }
          }[]
          if (
            !image[0]?.RepoDigests?.includes(expectedImages(record).app) ||
            image[0]?.Config?.Labels?.['org.opencontainers.image.revision'] !==
              record.sourceCommit ||
            (await imageConfigDigest(expectedImages(record).app, run)) !==
              record.imageId
          )
            throw new Error('Image identity mismatch')
          if (previous)
            await run('docker', [
              'image',
              'inspect',
              expectedImages(previous.release).app,
            ])
          await atomicWrite(candidateComposePath, configuration.compose)
          await compose(candidate, ['config', '--quiet'], candidateComposePath)
          await atomicWrite(
            resolve(paths.edgeDirectory, 'candidate.json'),
            serialize(rendered),
            0o644,
          )
          await edgeCommand([
            'validate',
            '--config',
            '/etc/caddy/candidate.json',
          ])
        },
        async stop() {
          await compose(candidate, ['stop', 'app'], candidateComposePath)
          await compose(candidate, ['rm', '-f', 'app'], candidateComposePath)
        },
        async start(r) {
          await atomicWrite(composePath, r.configuration.compose)
          await compose(r, ['up', '-d', '--no-deps', '--pull', 'never', 'app'])
        },
        async ready(r) {
          const id = await appId()
          if (!id) throw new Error('Missing app container')
          await waitReady(async () => {
            await run('docker', [
              'exec',
              id,
              'node',
              '-e',
              `const r=await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)});const b=await r.json();if(!r.ok||b.release!==${JSON.stringify(r.release.sourceCommit)})process.exit(1)`,
            ])
          }, r.profile.readinessSeconds)
        },
        async activate() {
          await activate(serialize(rendered))
        },
        async accept(r) {
          for (const path of [
            '/api/health',
            '/',
            '/api/episodes',
            '/feed/podcast',
          ]) {
            const response = await request(r.profile.webOrigin + path, {
              signal: AbortSignal.timeout(10_000),
              redirect: 'error',
              cache: 'no-store',
            })
            if (!response.ok)
              throw new Error(`HTTPS acceptance failed: ${path}`)
            if (path === '/api/health') {
              const body = (await response.json()) as { release?: string }
              if (body.release !== r.release.sourceCommit)
                throw new Error('HTTPS release identity mismatch')
            } else await response.arrayBuffer()
          }
          const audio = r.manifest.assets.find(
            (entry) =>
              entry.public &&
              entry.asset.kind === 'audio' &&
              entry.downloads.length > 0,
          )
          if (!audio)
            throw new Error(
              'No public audio available for deployment acceptance',
            )
          const slugs = new Set(
            audio.downloads.map((download) => download.slug),
          )
          await checkMediaHttp(
            {
              ...r.manifest,
              assets: [
                audio,
                ...r.manifest.assets
                  .filter(
                    (entry) => entry.public && entry.asset.kind === 'artwork',
                  )
                  .slice(0, 1),
              ],
              episodes: r.manifest.episodes.filter((episode) =>
                slugs.has(episode.slug),
              ),
            },
            { web: r.profile.webOrigin, media: r.profile.mediaOrigin },
            false,
            request,
          )
        },
        async restoreEdge() {
          await activate(edgeBytes)
        },
      }
      return deployRelease(state, candidate, previous, driver)
    }),
  )
}
