import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { deploymentCli } from '../../../tools/deploy/cli.ts'
import { serialize } from '../../../tools/deploy/manifest.ts'
import { releaseFixture } from './fixtures.ts'

const calls = vi.hoisted(() => ({
  deploy: vi.fn(async () => ({})),
  backup: vi.fn(async () => ({})),
  publish: vi.fn(async () => ({})),
  stage: vi.fn(async () => ({})),
  check: vi.fn(async () => ({})),
  scan: vi.fn(async () => ({})),
  http: vi.fn(async () => ({})),
  execute: vi.fn(async () =>
    JSON.stringify({
      event: 'push',
      conclusion: 'success',
      head_branch: 'main',
      head_sha: 'a'.repeat(40),
      path: '.github/workflows/verify.yml',
      repository: { full_name: 'treyturner/nurevolution.net' },
    }),
  ),
}))
vi.mock('../../../tools/deploy/host.ts', () => ({
  deployOnHost: calls.deploy,
  execute: calls.execute,
}))
vi.mock('../../../tools/deploy/backup.ts', () => ({ backup: calls.backup }))
vi.mock('../../../tools/deploy/publish.ts', () => ({
  publishImages: calls.publish,
}))
vi.mock('../../../tools/deploy/stage-assets.ts', () => ({
  stageAssets: calls.stage,
  checkAssets: calls.check,
}))
vi.mock('../../../tools/deploy/check-media.ts', () => ({
  scanSources: calls.scan,
  checkMediaHttp: calls.http,
}))
const dirs: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  for (const dir of dirs.splice(0))
    await fs.rm(dir, { recursive: true, force: true })
})

it('requires explicit valid commands/options and routes each operation to its checked implementation', async () => {
  const dir = await fs.mkdtemp(resolve(tmpdir(), 'nurevolution-cli-'))
  dirs.push(dir)
  const f = releaseFixture()
  await fs.mkdir(resolve(dir, 'state'))
  for (const key of ['release', 'manifest', 'configuration'] as const)
    await fs.writeFile(resolve(dir, key + '.json'), serialize(f[key]))
  await fs.writeFile(resolve(dir, 'state/previous.json'), serialize(f))
  const print = vi.fn(),
    manifest = ['--manifest', resolve(dir, 'manifest.json')],
    roots = ['--audio', 'audio', '--uploads', 'uploads']
  const host = [
    '--root',
    dir,
    '--edge-directory',
    'edge',
    '--edge-container',
    'container',
  ]
  for (const args of [
    ['check-assets', ...manifest, '--destination', 'target'],
    ['stage', ...manifest, ...roots, '--destination', 'target'],
    ['scan', ...manifest, ...roots],
    ['scan', ...manifest, ...roots, '--decode'],
    [
      'audit-http',
      ...manifest,
      '--web',
      'https://web.example',
      '--media',
      'https://media.example',
    ],
    [
      'audit-http',
      ...manifest,
      '--web',
      'https://web.example',
      '--media',
      'https://media.example',
      '--full',
    ],
    ['deploy', '--bundle', dir, ...host],
    ['rollback', ...host],
    ['backup', '--root', dir, '--edge-directory', 'edge'],
    ['publish', '--bundle', dir, '--run', '123'],
    ['verify-release', '--bundle', dir, '--run', '123'],
  ])
    expect(await deploymentCli(args, print)).toBe(0)
  expect(calls.stage).toHaveBeenCalledOnce()
  expect(calls.scan).toHaveBeenCalledTimes(2)
  expect(calls.http).toHaveBeenCalledTimes(2)
  expect(calls.deploy).toHaveBeenCalledTimes(2)
  expect((await fs.readdir(dir)).some((n) => n.startsWith('rollback-'))).toBe(
    false,
  )
  for (const args of [
    [],
    ['unknown'],
    ['scan'],
    ['scan', '--unknown'],
    ['publish', '--bundle', dir],
    ['verify-release', '--bundle', dir, '--run', '0'],
    ['verify-release', '--bundle', dir, '--run', '456'],
  ])
    await expect(deploymentCli(args, print)).rejects.toThrow()
})
