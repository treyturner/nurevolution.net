import { dirname, resolve } from 'node:path'
import { isMain, parseArguments, runCli } from './cli.ts'
import { reconcileFiles } from './files.ts'
import {
  createCandidate,
  inputPaths,
  projectRoot,
  readSources,
} from './source.ts'

export async function importWordpress(
  args: string[],
  print: (message: string) => void = console.log,
) {
  const { output, mode } = parseArguments(args, true)
  const candidate = createCandidate(await readSources())
  const result = await reconcileFiles(
    candidate.files,
    output,
    Object.values(inputPaths).map((path) =>
      dirname(resolve(projectRoot, path)),
    ),
    mode === 'write',
  )
  print(
    JSON.stringify(
      { mode, counts: candidate.report.actual, ...result },
      null,
      2,
    ),
  )
  return result.conflicts.length || (mode === 'check' && result.create.length)
    ? 2
    : 0
}

if (isMain(import.meta.url))
  process.exitCode = await runCli(
    () => importWordpress(process.argv.slice(2)),
    console.error,
  )
