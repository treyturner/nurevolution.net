import { pathToFileURL } from 'node:url'

export function isMain(url: string) {
  return (
    process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === url
  )
}

export function parseArguments(args: string[], allowImport: boolean) {
  let output = 'content',
    mode: 'dry-run' | 'write' | 'check' = 'dry-run'
  const seen = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`)
    seen.add(arg)
    if (arg === '--output' && args[i + 1] && !args[i + 1]!.startsWith('--'))
      output = args[++i]!
    else if (
      allowImport &&
      ['--write', '--check'].includes(arg) &&
      mode === 'dry-run'
    )
      mode = arg === '--write' ? 'write' : 'check'
    else
      throw new Error(
        `Invalid option: ${arg}; expected --output <directory>${allowImport ? ' and either --write or --check' : ''}`,
      )
  }
  return { output, mode }
}

export async function runCli(
  task: () => Promise<number>,
  print: (message: string) => void,
) {
  try {
    return await task()
  } catch (error) {
    print(
      error instanceof Error
        ? `${error.message}${error.cause instanceof Error ? `: ${error.cause.message}` : ''}`
        : String(error),
    )
    return 1
  }
}
