import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isMain, runCli } from '../content/cli.ts'
import { validateManifest, serialize } from './manifest.ts'
import { stageAssets, checkAssets } from './stage-assets.ts'
import { scanSources, checkMediaHttp } from './check-media.ts'
import { deployOnHost, execute } from './host.ts'
import { readRelease, assertTrustedRun } from './release.ts'
import { publishImages } from './publish.ts'
import { backup } from './backup.ts'

export async function deploymentCli(
  args: string[],
  print: (value: string) => void = console.log,
) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      manifest: { type: 'string' },
      audio: { type: 'string' },
      uploads: { type: 'string' },
      destination: { type: 'string' },
      web: { type: 'string' },
      media: { type: 'string' },
      decode: { type: 'boolean' },
      full: { type: 'boolean' },
      bundle: { type: 'string' },
      root: { type: 'string' },
      'edge-directory': { type: 'string' },
      'edge-container': { type: 'string' },
      run: { type: 'string' },
    },
  })
  const get = (key: keyof typeof values) => {
    const value = values[key]
    if (typeof value !== 'string' || !value)
      throw new Error(`Required option: --${key}`)
    return value
  }
  if (positionals.length !== 1)
    throw new Error(
      'Expected one command: stage, check-assets, scan, audit-http, verify-release, deploy, rollback',
    )
  const command = positionals[0]
  if (command === 'backup') {
    print(serialize(await backup(get('root'), get('edge-directory'))))
  } else if (command === 'publish') {
    print(
      serialize(
        await publishImages(get('bundle'), get('run'), {
          repository: process.env.GITHUB_REPOSITORY,
          ref: process.env.GITHUB_REF,
          event: process.env.GITHUB_EVENT_NAME,
          commit: process.env.GITHUB_SHA,
        }),
      ),
    )
  } else if (command === 'deploy') {
    print(
      serialize(
        await deployOnHost(get('bundle'), {
          root: get('root'),
          edgeDirectory: get('edge-directory'),
          edgeContainer: get('edge-container'),
        }),
      ),
    )
  } else if (command === 'rollback') {
    const root = get('root')
    const previous = JSON.parse(
      await fs.readFile(resolve(root, 'state/previous.json'), 'utf8'),
    ) as { release: unknown; manifest: unknown; configuration: unknown }
    const bundle = await fs.mkdtemp(resolve(root, 'rollback-'))
    try {
      for (const key of ['release', 'manifest', 'configuration'] as const)
        await fs.writeFile(
          resolve(bundle, key + '.json'),
          serialize(previous[key]),
          { mode: 0o600 },
        )
      print(
        serialize(
          await deployOnHost(bundle, {
            root,
            edgeDirectory: get('edge-directory'),
            edgeContainer: get('edge-container'),
          }),
        ),
      )
    } finally {
      await fs.rm(bundle, { recursive: true, force: true })
    }
  } else if (command === 'verify-release') {
    const bundle = get('bundle')
    const { record } = readRelease(
      JSON.parse(await fs.readFile(resolve(bundle, 'release.json'), 'utf8')),
      await fs.readFile(resolve(bundle, 'manifest.json'), 'utf8'),
      await fs.readFile(resolve(bundle, 'configuration.json'), 'utf8'),
    )
    const runId = get('run')
    if (
      !/^[1-9][0-9]*$/.test(runId) ||
      !record.verifyRunUrl.endsWith('/' + runId)
    )
      throw new Error('Invalid verification run')
    const run = JSON.parse(
      await execute('gh', [
        'api',
        `repos/treyturner/nurevolution.net/actions/runs/${runId}`,
      ]),
    ) as Parameters<typeof assertTrustedRun>[0]
    assertTrustedRun(run, record.sourceCommit)
    print(
      serialize({
        valid: true,
        sourceCommit: record.sourceCommit,
        imageDigest: record.imageDigest,
      }),
    )
  } else if (
    ['stage', 'check-assets', 'scan', 'audit-http'].includes(command!)
  ) {
    const manifest = validateManifest(
      JSON.parse(await fs.readFile(get('manifest'), 'utf8')),
    )
    let result: unknown
    if (command === 'check-assets')
      result = await checkAssets(manifest, get('destination'))
    else if (command === 'audit-http')
      result = await checkMediaHttp(
        manifest,
        { web: get('web'), media: get('media') },
        values.full ?? false,
      )
    else {
      const roots = { audio: get('audio'), uploads: get('uploads') }
      result =
        command === 'stage'
          ? await stageAssets(manifest, roots, get('destination'))
          : await scanSources(manifest, roots, values.decode ?? false)
    }
    print(serialize(result))
  } else throw new Error(`Unknown deployment command: ${command}`)
  return 0
}

// The bundled host entry point shares the same command parser as source usage.
if (isMain(import.meta.url))
  process.exitCode = await runCli(
    () => deploymentCli(process.argv.slice(2)),
    console.error,
  )
