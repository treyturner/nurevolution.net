import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  archiveConfigDigest,
  imageConfigDigest,
} from '../../../tools/deploy/image-identity.ts'
import { execute, type Execute } from '../../../tools/deploy/host.ts'
import { sha256 } from '../../../tools/deploy/manifest.ts'
import { imageConfiguration } from './fixtures.ts'

const directories: string[] = []
afterEach(async () => {
  for (const path of directories.splice(0))
    await fs.rm(path, { recursive: true, force: true })
})

async function archive(
  layout: 'classic' | 'oci',
  bytes = imageConfiguration('app'),
) {
  const directory = await fs.mkdtemp(
    resolve(tmpdir(), 'nurevolution-identity-test-'),
  )
  directories.push(directory)
  const config =
    layout === 'classic'
      ? sha256(bytes) + '.json'
      : 'blobs/sha256/' + sha256(bytes)
  await fs.mkdir(resolve(directory, 'blobs/sha256'), { recursive: true })
  await fs.writeFile(resolve(directory, config), bytes)
  await fs.writeFile(
    resolve(directory, 'manifest.json'),
    JSON.stringify([{ Config: config }]),
  )
  const file = resolve(directory, 'image.tar')
  await execute('tar', ['-cf', file, '-C', directory, 'manifest.json', config])
  return { directory, file, config, bytes }
}

it.each(['classic', 'oci'] as const)(
  'hashes original %s configuration bytes, including trailing whitespace',
  async (layout) => {
    const f = await archive(layout)
    expect(f.bytes.endsWith('\n')).toBe(true)
    expect(await archiveConfigDigest(f.file, execute)).toBe(
      'sha256:' + sha256(f.bytes),
    )
    expect(sha256(f.bytes)).not.toBe(sha256(f.bytes.trim()))
  },
)

it('rejects changed bytes even when the archive advertises the expected config filename', async () => {
  const f = await archive('oci')
  await fs.appendFile(resolve(f.directory, f.config), ' ')
  await execute('tar', [
    '-cf',
    f.file,
    '-C',
    f.directory,
    'manifest.json',
    f.config,
  ])
  await expect(archiveConfigDigest(f.file, execute)).rejects.toThrow(
    'checksum mismatch',
  )
})

it.each([
  { manifest: [] },
  { manifest: [{ Config: '../../secret' }] },
  { manifest: [{ Config: '--checkpoint-action=exec=bad' }] },
  {
    manifest: [
      { Config: 'a'.repeat(64) + '.json' },
      { Config: 'b'.repeat(64) + '.json' },
    ],
  },
])(
  'rejects ambiguous or unsafe archive metadata before reading a config: %j',
  async ({ manifest }) => {
    const run = vi.fn<Execute>(async () => JSON.stringify(manifest))
    await expect(archiveConfigDigest('/archive.tar', run)).rejects.toThrow()
    expect(run).toHaveBeenCalledTimes(1)
  },
)

it.each([
  { os: 'windows', architecture: 'amd64' },
  { os: 'linux', architecture: 'arm64' },
])('rejects the wrong target platform: %j', async (config) => {
  const f = await archive('classic', JSON.stringify(config))
  await expect(archiveConfigDigest(f.file, execute)).rejects.toThrow(
    'linux/amd64',
  )
})

it.each([false, true])(
  'streams export to a private directory and removes it after success or failure (failure: %s)',
  async (fail) => {
    const f = await archive('oci')
    let temporary = ''
    const run: Execute = async (command, args, env, timeout, trim) => {
      if (command === 'docker') {
        expect(args.slice(0, 5)).toEqual([
          'image',
          'save',
          '--platform',
          'linux/amd64',
          '--output',
        ])
        expect(args.at(-1)).toBe(
          'registry.example/app@sha256:' + 'a'.repeat(64),
        )
        temporary = args[5]!
        expect((await fs.stat(resolve(temporary, '..'))).mode & 0o777).toBe(
          0o700,
        )
        await fs.copyFile(f.file, temporary)
        if (fail) throw new Error('Export interrupted')
        return ''
      }
      return execute(command, args, env, timeout, trim)
    }
    const result = imageConfigDigest(
      'registry.example/app@sha256:' + 'a'.repeat(64),
      run,
    )
    if (fail) await expect(result).rejects.toThrow('Export interrupted')
    else expect(await result).toBe('sha256:' + sha256(f.bytes))
    await expect(fs.stat(resolve(temporary, '..'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  },
)
