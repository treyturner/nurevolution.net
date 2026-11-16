import { build } from 'esbuild'
import { isMain, runCli } from '../content/cli.ts'

export async function bundleDeployment(
  outfile = '.local/delivery/artifacts/deploy.mjs',
) {
  await build({
    entryPoints: ['tools/deploy/cli.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    // Bundled CommonJS dependencies still require Node builtins at runtime.
    // Provide a real require without depending on installed node_modules.
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  })
}

if (isMain(import.meta.url))
  process.exitCode = await runCli(async () => {
    await bundleDeployment()
    return 0
  }, console.error)
