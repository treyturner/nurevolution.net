import * as fs from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { assertRollbackCompatible, serialize } from './manifest.ts'
import {
  effectiveManifest,
  publicationRelease,
  type DeploymentRecord,
} from './release.ts'

export async function syncDirectory(path: string) {
  const directory = await fs.open(path, 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

async function removeFile(path: string) {
  await fs.rm(path, { force: true })
  await syncDirectory(dirname(path))
}

export async function atomicWrite(
  path: string,
  bytes: string,
  mode: 0o600 | 0o644 = 0o600,
) {
  const temp = path + '.pending'
  const file = await fs.open(temp, 'wx', 0o600)
  try {
    try {
      await file.writeFile(bytes)
      // Set final permissions explicitly, including under an operator's 0077 umask.
      await file.chmod(mode)
      await file.sync()
    } finally {
      await file.close()
    }
    await fs.rename(temp, path)
    await syncDirectory(dirname(path))
  } finally {
    await removeFile(temp)
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
    await syncDirectory(dirname(path))
    return await operation()
  } finally {
    await fs.rmdir(path)
    await syncDirectory(dirname(path))
  }
}

export interface DeploymentDriver {
  preflight(): Promise<void>
  prepare(): Promise<void>
  prepareFallback?(record: DeploymentRecord): Promise<void>
  stop(): Promise<void>
  start(record: DeploymentRecord): Promise<void>
  ready(record: DeploymentRecord): Promise<void>
  activate(record: DeploymentRecord): Promise<void>
  accept(record: DeploymentRecord): Promise<void>
  restoreEdge(record?: DeploymentRecord): Promise<void>
}

export function reconcileFallback(
  candidate: DeploymentRecord,
  previous?: DeploymentRecord,
) {
  if (!previous) return undefined
  assertRollbackCompatible(
    effectiveManifest(previous),
    effectiveManifest(candidate),
  )
  const fallback =
    candidate.configuration.publication && previous.configuration.publication
      ? { ...previous, publication: publicationRelease(candidate) }
      : previous
  assertRollbackCompatible(
    effectiveManifest(candidate),
    effectiveManifest(fallback),
  )
  return fallback
}

export async function deployRelease(
  directory: string,
  candidate: DeploymentRecord,
  previous: DeploymentRecord | undefined,
  driver: DeploymentDriver,
) {
  const fallback = reconcileFallback(candidate, previous)
  await driver.preflight()
  await driver.prepare()
  if (fallback?.publication) {
    if (!driver.prepareFallback)
      throw new Error('Publication fallback must be verified before activation')
    await driver.prepareFallback(fallback)
  }
  previous = fallback
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
      await driver.restoreEdge(previous)
      if (previous) {
        await driver.accept(previous)
        await atomicWrite(
          resolve(directory, 'current.json'),
          serialize(previous),
        )
        outcome = 'restored'
      } else await removeFile(resolve(directory, 'current.json'))
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
    if (completed) await removeFile(resolve(directory, 'pending.json'))
  }
}
