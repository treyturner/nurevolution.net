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
      // Fixed resource bounds leave room for the running site on a 1 GB host.
      const env = {
        GOMAXPROCS: '1',
        GOMEMLIMIT: '128MiB',
      }
      await run(
        'restic',
        [
          'backup',
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
      await run('restic', ['check'], env)
      // Preview the retention result in the runbook before enabling the timer.
      await run(
        'restic',
        [
          'forget',
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
      const snapshots = JSON.parse(
        await run('restic', [
          'snapshots',
          '--tag',
          'nurevolution',
          '--host',
          'nurevolution',
          '--latest',
          '1',
          '--json',
        ]),
      ) as { id: string }[]
      if (!snapshots[0]?.id) throw new Error('No recoverable snapshot recorded')
      const result = {
        at: new Date().toISOString(),
        snapshotId: snapshots[0].id,
        repositoryCheck: 'passed',
      }
      await atomicWrite(resolve(root, 'state/backup.json'), serialize(result))
      return result
    }),
  )
}
