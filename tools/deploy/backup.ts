import { resolve } from 'node:path'
import { withLock, atomicWrite } from './deploy.ts'
import { execute, type Execute } from './host.ts'
import { serialize } from './manifest.ts'

export async function backup(
  root: string,
  edgeDirectory: string,
  run: Execute = execute,
) {
  return withLock(resolve(root, 'state/deploy.lock'), () =>
    withLock(resolve(edgeDirectory, 'deploy.lock'), async () => {
      if (!(await run('restic', ['version'])).startsWith('restic 0.19.1 '))
        throw new Error('Expected pinned restic 0.19.1')
      // The full archive exceeded the 192 MiB service cap at five S3 connections.
      // Bound upload buffers as well as the Go heap on the 1 GB host.
      const env = {
        GOMAXPROCS: '1',
        GOMEMLIMIT: '96MiB',
        // JSON progress defaults to ten updates/second, overflowing captured output.
        RESTIC_PROGRESS_FPS: '0.016666',
      }
      const limits = ['-o', 's3.connections=2', '--pack-size', '8']
      const output = await run(
        'restic',
        [
          'backup',
          ...limits,
          '--json',
          '--compression',
          'off',
          '--tag',
          'nurevolution',
          '--host',
          'nurevolution',
          '--read-concurrency',
          '1',
          '--exclude',
          '**/deploy.lock',
          resolve(root, 'media'),
          resolve(root, 'state'),
          resolve(root, 'releases'),
          resolve(root, 'profile.json'),
          resolve(root, 'tooling'),
          edgeDirectory,
          '/srv/edge/data',
        ],
        env,
        90 * 60 * 1000,
      )
      // A latest-snapshot query can include other path/tag groups (e.g. rehearsal).
      const summary = output
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as { message_type?: string; snapshot_id?: string },
        )
        .findLast((entry) => entry.message_type === 'summary')
      if (!summary?.snapshot_id)
        throw new Error('No recoverable snapshot recorded')
      await run('restic', ['check', ...limits], env)
      // Preview the retention result in the runbook before enabling the timer.
      await run(
        'restic',
        [
          'forget',
          ...limits,
          '--tag',
          'nurevolution',
          '--host',
          'nurevolution',
          '--group-by',
          'host,tags',
          '--keep-weekly',
          '4',
          '--keep-monthly',
          '3',
        ],
        env,
      )
      const result = {
        at: new Date().toISOString(),
        snapshotId: summary.snapshot_id,
        repositoryCheck: 'passed',
      }
      await atomicWrite(resolve(root, 'state/backup.json'), serialize(result))
      return result
    }),
  )
}
