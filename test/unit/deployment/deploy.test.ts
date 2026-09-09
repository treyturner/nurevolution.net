import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  atomicWrite,
  deployRelease,
  withLock,
  type DeploymentDriver,
} from '../../../tools/deploy/deploy.ts'
import { releaseFixture } from './fixtures.ts'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true })
})
async function fixture() {
  const directory = await fs.mkdtemp(resolve(tmpdir(), 'nurevolution-deploy-'))
  directories.push(directory)
  const calls: string[] = []
  const driver = Object.fromEntries(
    [
      'preflight',
      'prepare',
      'stop',
      'start',
      'ready',
      'activate',
      'accept',
      'restoreEdge',
    ].map((name) => [
      name,
      vi.fn(async () => {
        calls.push(name)
      }),
    ]),
  ) as unknown as DeploymentDriver
  return { directory, driver, calls }
}

it('serializes deployments and preserves a crash marker instead of guessing lock ownership', async () => {
  const f = await fixture(),
    path = resolve(f.directory, 'lock')
  await withLock(path, async () => {
    await expect(withLock(path, async () => 1)).rejects.toThrow(
      'lock unavailable',
    )
  })
  expect(await withLock(path, async () => 2)).toBe(2)
  const output = resolve(f.directory, 'record')
  await atomicWrite(output, 'one')
  await atomicWrite(output, 'two')
  expect(await fs.readFile(output, 'utf8')).toBe('two')
  await fs.mkdir(resolve(f.directory, 'directory'))
  await expect(
    atomicWrite(resolve(f.directory, 'directory'), 'invalid'),
  ).rejects.toThrow()
})

it('preflights before interruption, persists release state, and restores a failed candidate', async () => {
  const f = await fixture(),
    record = releaseFixture()
  await deployRelease(f.directory, record, undefined, f.driver)
  expect(f.calls).toEqual([
    'preflight',
    'prepare',
    'stop',
    'start',
    'ready',
    'activate',
    'accept',
  ])
  expect(
    JSON.parse(await fs.readFile(resolve(f.directory, 'current.json'), 'utf8')),
  ).toEqual(record)
  await deployRelease(f.directory, record, record, f.driver)
  expect(
    JSON.parse(
      await fs.readFile(resolve(f.directory, 'previous.json'), 'utf8'),
    ),
  ).toEqual(record)
  vi.mocked(f.driver.ready).mockRejectedValueOnce(new Error('unhealthy'))
  await expect(
    deployRelease(f.directory, record, record, f.driver),
  ).rejects.toThrow('restored')
  expect(f.calls.slice(-4)).toEqual(['start', 'ready', 'restoreEdge', 'accept'])
  expect(
    JSON.parse(
      await fs.readFile(resolve(f.directory, 'last-attempt.json'), 'utf8'),
    ).outcome,
  ).toBe('restored')
  vi.mocked(f.driver.preflight).mockRejectedValueOnce(new Error('headroom'))
  const stops = vi.mocked(f.driver.stop).mock.calls.length
  await expect(
    deployRelease(f.directory, record, record, f.driver),
  ).rejects.toThrow('headroom')
  expect(vi.mocked(f.driver.stop).mock.calls.length).toBe(stops)
})

it('handles first-deploy failures, post-activation failures, and failed recovery explicitly', async () => {
  const f = await fixture(),
    record = releaseFixture()
  vi.mocked(f.driver.accept).mockRejectedValueOnce(new Error('HTTPS failure'))
  await expect(
    deployRelease(f.directory, record, undefined, f.driver),
  ).rejects.toThrow('undeployed')
  await expect(fs.stat(resolve(f.directory, 'current.json'))).rejects.toThrow()
  vi.mocked(f.driver.accept).mockRejectedValueOnce(new Error('HTTPS failure'))
  vi.mocked(f.driver.restoreEdge).mockRejectedValueOnce(new Error('edge lost'))
  await expect(
    deployRelease(f.directory, record, record, f.driver),
  ).rejects.toThrow('Deployment and recovery failed')
  expect(
    await fs.readFile(resolve(f.directory, 'pending.json'), 'utf8'),
  ).toContain(record.release.imageDigest)
})
