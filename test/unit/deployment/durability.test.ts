import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  deployRelease,
  withLock,
  type DeploymentDriver,
} from '../../../tools/deploy/deploy.ts'
import { releaseFixture } from './fixtures.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})
const open = vi.mocked(fs.open).getMockImplementation()!
const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(fs.open).mockImplementation(open)
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const directory = await fs.mkdtemp(
    resolve(tmpdir(), 'nurevolution-durability-'),
  )
  directories.push(directory)
  const driver: DeploymentDriver = {
    preflight: vi.fn(),
    prepare: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    ready: vi.fn(),
    activate: vi.fn(),
    accept: vi.fn(),
    restoreEdge: vi.fn(),
  }
  return { directory, driver }
}

function holdRemovalFlush(directory: string, removed: string, fail = false) {
  let entered!: () => void, release!: () => void
  const reached = new Promise<void>((resolve) => {
    entered = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
    const handle = await open(path, flags, mode)
    if (path === directory && flags === 'r') {
      const sync = handle.sync.bind(handle)
      vi.spyOn(handle, 'sync').mockImplementation(async () => {
        const absent = await fs.stat(removed).then(
          () => false,
          () => true,
        )
        if (absent) {
          entered()
          await held
          if (fail) throw new Error('Simulated directory flush failure')
        }
        await sync()
      })
    }
    return handle
  })
  return { reached, release }
}

it.each(['deployed', 'restored', 'undeployed'])(
  'waits for durable journal removal before completing the %s outcome',
  async (outcome) => {
    const f = await fixture(),
      record = releaseFixture()
    if (outcome === 'restored')
      await deployRelease(f.directory, record, undefined, f.driver)
    if (outcome !== 'deployed')
      vi.mocked(f.driver.accept).mockRejectedValueOnce(
        new Error('Candidate failed'),
      )
    const gate = holdRemovalFlush(
      f.directory,
      resolve(f.directory, 'pending.json'),
    )
    let settled = false
    const operation = deployRelease(
      f.directory,
      record,
      outcome === 'restored' ? record : undefined,
      f.driver,
    )
      .catch((error: unknown) => error)
      .then((value) => {
        settled = true
        return value
      })
    try {
      expect(
        await Promise.race([
          gate.reached.then(() => 'flush'),
          operation.then(() => 'completed'),
        ]),
      ).toBe('flush')
      expect(settled).toBe(false)
      expect(
        JSON.parse(
          await fs.readFile(resolve(f.directory, 'last-attempt.json'), 'utf8'),
        ).outcome,
      ).toBe(outcome)
    } finally {
      gate.release()
    }
    const result = await operation
    if (outcome === 'deployed') expect(result).toEqual(record)
    else expect(String(result)).toContain(outcome)
  },
)

it.each([false, true])(
  'flushes lock removal before completion and propagates flush failure (%s)',
  async (fail) => {
    const f = await fixture(),
      lock = resolve(f.directory, 'deploy.lock')
    const gate = holdRemovalFlush(f.directory, lock, fail)
    let settled = false
    const operation = withLock(lock, async () => 'operation completed')
      .catch((error: unknown) => error)
      .then((value) => {
        settled = true
        return value
      })
    try {
      expect(
        await Promise.race([
          gate.reached.then(() => 'flush'),
          operation.then(() => 'completed'),
        ]),
      ).toBe('flush')
      expect(settled).toBe(false)
    } finally {
      gate.release()
    }
    const result = await operation
    if (fail) expect(String(result)).toContain('directory flush failure')
    else expect(result).toBe('operation completed')
  },
)

it('reports a journal-removal flush failure instead of returning deployment success', async () => {
  const f = await fixture(),
    record = releaseFixture()
  const gate = holdRemovalFlush(
    f.directory,
    resolve(f.directory, 'pending.json'),
    true,
  )
  const operation = deployRelease(
    f.directory,
    record,
    undefined,
    f.driver,
  ).catch((error: unknown) => error)
  try {
    expect(
      await Promise.race([
        gate.reached.then(() => 'flush'),
        operation.then(() => 'completed'),
      ]),
    ).toBe('flush')
  } finally {
    gate.release()
  }
  expect(String(await operation)).toContain('directory flush failure')
})
