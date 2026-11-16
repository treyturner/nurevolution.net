import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { bundleDeployment } from '../../../tools/deploy/bundle.ts'
import { deliveryFixture } from '../../delivery/fixture.ts'
import { serialize } from '../../../tools/deploy/manifest.ts'

it('executes the bundled deployment CLI without installed dependencies', async () => {
  const root = await fs.mkdtemp(resolve(tmpdir(), 'standalone-deploy-'))
  try {
    const bundle = resolve(root, 'deploy.mjs')
    await bundleDeployment(bundle)
    const fixture = await deliveryFixture(
      resolve(root, 'media'),
      'a'.repeat(40),
    )
    const manifest = resolve(root, 'manifest.json')
    await fs.writeFile(manifest, serialize(fixture.manifest))
    // The publisher and droplet receive this one file without a node_modules tree.
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [
        bundle,
        'check-assets',
        '--manifest',
        manifest,
        '--destination',
        resolve(root, 'media'),
      ],
      { cwd: root },
    )
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual({
      files: 4,
      bytes: fixture.manifest.assets.reduce(
        (total, entry) => total + entry.asset.byteLength,
        0,
      ),
    })
    expect(await fs.readdir(root)).toEqual(
      expect.arrayContaining(['deploy.mjs', 'manifest.json', 'media']),
    )
    expect(await fs.readdir(root)).not.toContain('node_modules')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
