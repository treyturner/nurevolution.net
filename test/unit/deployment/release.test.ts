import { expect, it } from 'vitest'
import {
  assertTrustedRun,
  expectedImages,
  readRelease,
} from '../../../tools/deploy/release.ts'
import { serialize } from '../../../tools/deploy/manifest.ts'
import { releaseFixture } from './fixtures.ts'

it('binds release records to exact manifests, configuration, commit, and image repository', () => {
  const f = releaseFixture()
  expect(
    readRelease(f.release, serialize(f.manifest), serialize(f.configuration))
      .record,
  ).toEqual(f.release)
  expect(expectedImages(f.release).app).toBe(
    'ghcr.io/treyturner/nurevolution.net@' + f.release.imageDigest,
  )
  expect(() =>
    expectedImages({ ...f.release, imageDigest: 'evil:latest' }),
  ).toThrow()
  expect(() =>
    readRelease(
      f.release,
      serialize(f.manifest) + ' ',
      serialize(f.configuration),
    ),
  ).toThrow('checksum')
  expect(() =>
    readRelease(
      { ...f.release, sourceCommit: 'b'.repeat(40) },
      serialize(f.manifest),
      serialize(f.configuration),
    ),
  ).toThrow('commit')
})

it('requires the exact successful main verification run before promotion', () => {
  const run = {
    event: 'push',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: 'a'.repeat(40),
    path: '.github/workflows/verify.yml',
    repository: { full_name: 'treyturner/nurevolution.net' },
  }
  expect(() => assertTrustedRun(run, run.head_sha)).not.toThrow()
  for (const patch of [
    { event: 'pull_request' },
    { conclusion: null },
    { head_branch: 'feature' },
    { head_sha: 'b'.repeat(40) },
    { path: 'other.yml' },
    { repository: { full_name: 'fork/project' } },
  ])
    expect(() => assertTrustedRun({ ...run, ...patch }, run.head_sha)).toThrow(
      'trusted main',
    )
})
