import * as fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { copyFixtureRuntime } from '../../delivery/fixture.ts'

it('loads a staged Nitro dependency after relocating the runtime and removing its source', async () => {
  const directory = await fs.mkdtemp(resolve(tmpdir(), 'nurevolution-runtime-'))
  try {
    const source = resolve(directory, 'source')
    const modules = resolve(source, 'server/node_modules')
    const dependency = resolve(modules, '.nitro/@fixture/shared@1.0.0')
    await fs.mkdir(dependency, { recursive: true })
    await fs.mkdir(resolve(modules, '@fixture'), { recursive: true })
    await fs.writeFile(
      resolve(dependency, 'index.js'),
      'module.exports = "isolated runtime dependency"',
    )
    await fs.symlink(
      '../.nitro/@fixture/shared@1.0.0',
      resolve(modules, '@fixture/shared'),
    )

    const staged = resolve(directory, 'staged')
    const relocated = resolve(directory, 'isolated')
    await copyFixtureRuntime(source, staged)
    await fs.rename(staged, relocated)
    await fs.rm(source, { recursive: true })

    const require = createRequire(resolve(relocated, 'server/index.cjs'))
    expect(require('@fixture/shared')).toBe('isolated runtime dependency')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
