import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertRollbackCompatible, serialize } from './manifest.ts'
import type { DeploymentRecord } from './release.ts'

export async function atomicWrite(path: string, bytes: string) {
  const temp = path + '.pending'
  await fs.writeFile(temp, bytes, { flag: 'wx', mode: 0o600 })
  try {
    await fs.rename(temp, path)
  } finally {
    await fs.rm(temp, { force: true })
  }
}

export async function withLock<T>(path: string, operation: () => Promise<T>) {
  try {
    await fs.mkdir(path)
  } catch {
    throw new Error(
      `Deployment lock unavailable: ${path}; inspect interrupted operations before removing it`,
    )
  }
  try {
    return await operation()
  } finally {
    await fs.rmdir(path)
  }
}

export interface DeploymentDriver {
  preflight(): Promise<void>
  prepare(): Promise<void>
  stop(): Promise<void>
  start(record: DeploymentRecord): Promise<void>
  ready(record: DeploymentRecord): Promise<void>
  activate(record: DeploymentRecord): Promise<void>
  accept(record: DeploymentRecord): Promise<void>
  restoreEdge(): Promise<void>
}

export async function deployRelease(
  directory: string,
  candidate: DeploymentRecord,
  previous: DeploymentRecord | undefined,
  driver: DeploymentDriver,
) {
  if (previous) {
    assertRollbackCompatible(previous.manifest, candidate.manifest)
    assertRollbackCompatible(candidate.manifest, previous.manifest)
  }
  await driver.preflight()
  await driver.prepare()
  // Durable intent precedes every disruptive operation. A process crash leaves
  // the lock and this journal for explicit recovery, never a guessed success.
  await atomicWrite(
    resolve(directory, 'pending.json'),
    serialize({ candidate, previous: previous ?? null }),
  )
  let outcome: 'deployed' | 'restored' | 'undeployed' | 'recovery-failed' =
    'undeployed'
  let completed = false
  try {
    await driver.stop()
    await driver.start(candidate)
    await driver.ready(candidate)
    await driver.activate(candidate)
    await driver.accept(candidate)
    await atomicWrite(resolve(directory, 'current.json'), serialize(candidate))
    if (previous)
      await atomicWrite(
        resolve(directory, 'previous.json'),
        serialize(previous),
      )
    outcome = 'deployed'
    completed = true
    return candidate
  } catch (error) {
    try {
      await driver.stop()
      if (previous) {
        await driver.start(previous)
        await driver.ready(previous)
      }
      await driver.restoreEdge()
      if (previous) {
        await driver.accept(previous)
        await atomicWrite(
          resolve(directory, 'current.json'),
          serialize(previous),
        )
        outcome = 'restored'
      } else await fs.rm(resolve(directory, 'current.json'), { force: true })
      completed = true
    } catch (recovery) {
      outcome = 'recovery-failed'
      throw new AggregateError(
        [error, recovery],
        `Deployment and recovery failed; use pending.json. Candidate ${candidate.release.imageDigest}; previous ${previous?.release.imageDigest ?? 'none'}`,
        { cause: recovery },
      )
    }
    throw new Error(`Deployment failed; ${outcome}`, { cause: error })
  } finally {
    await atomicWrite(
      resolve(directory, 'last-attempt.json'),
      serialize({
        outcome,
        candidate: candidate.release.imageDigest,
        previous: previous?.release.imageDigest ?? null,
        at: new Date().toISOString(),
      }),
    )
    if (completed)
      await fs.rm(resolve(directory, 'pending.json'), { force: true })
  }
}
