import * as fs from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { relativePathSchema } from '../../shared/content/schema.ts'
import type { DocumentReader } from '../../server/content/repository.ts'

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export async function assertNoSymlinks(path: string) {
  const absolute = resolve(path)
  for (let cursor = absolute; ; cursor = dirname(cursor)) {
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink())
        throw new Error(`Symlink is not a content destination: ${cursor}`)
    } catch (error) {
      if (!missing(error)) throw error
    }
    if (cursor === dirname(cursor)) break
  }
}

export async function listFiles(root: string): Promise<string[]> {
  await assertNoSymlinks(root)
  async function walk(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const result: string[] = []
    for (const entry of entries) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) result.push(...(await walk(path)))
      else if (entry.isFile())
        result.push(relative(root, path).split(sep).join('/'))
      else throw new Error(`Unsupported content entry: ${path}`)
    }
    return result.sort()
  }
  try {
    return await walk(root)
  } catch (error) {
    if (missing(error)) {
      try {
        await fs.lstat(root)
      } catch (rootError) {
        if (missing(rootError)) return []
        throw rootError
      }
    }
    throw error
  }
}

export function fileReader(root: string): DocumentReader {
  return {
    list: () => listFiles(root),
    async read(path) {
      relativePathSchema.parse(path)
      const full = resolve(root, path)
      await assertNoSymlinks(full)
      return JSON.parse(await fs.readFile(full, 'utf8')) as unknown
    },
  }
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return (
    path === '' ||
    (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  )
}

export async function reconcileFiles(
  files: Map<string, string>,
  output: string,
  protectedDirectories: string[],
  write: boolean,
  linkFile: (source: string, target: string) => Promise<void> = fs.link,
) {
  output = resolve(output)
  for (const directory of protectedDirectories) {
    if (
      contains(resolve(directory), output) ||
      contains(output, resolve(directory))
    )
      throw new Error('Output overlaps migration evidence')
  }
  for (const path of files.keys()) relativePathSchema.parse(path)
  const existing = await listFiles(output)
  const create: string[] = [],
    identical: string[] = [],
    conflicts: string[] = []
  for (const [path, bytes] of files) {
    if (!existing.includes(path)) create.push(path)
    else if ((await fs.readFile(resolve(output, path), 'utf8')) === bytes)
      identical.push(path)
    else conflicts.push(path)
  }
  conflicts.push(...existing.filter((path) => !files.has(path)))
  const result = { create, identical, conflicts }
  if (!write || conflicts.length || !create.length) return result

  const created: { path: string; ino: number; dev: number }[] = []
  const directories: string[] = []
  async function mkdir(path: string) {
    try {
      await fs.mkdir(path)
      directories.push(path)
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        await mkdir(dirname(path))
        await mkdir(path)
      } else if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'EEXIST' &&
        (await fs.lstat(path)).isDirectory()
      ))
        throw error
    }
  }
  let staging: string | undefined
  try {
    await mkdir(output)
    staging = await fs.mkdtemp(resolve(output, '.m2-stage-'))
    for (const [index, path] of create.entries())
      await fs.writeFile(resolve(staging, String(index)), files.get(path)!, {
        flag: 'wx',
      })
    for (const [index, path] of create.entries()) {
      const target = resolve(output, path)
      await mkdir(dirname(target))
      await assertNoSymlinks(target)
      const source = resolve(staging, String(index))
      const stat = await fs.lstat(source)
      await linkFile(source, target)
      created.push({ path: target, ino: stat.ino, dev: stat.dev })
    }
    return result
  } catch (error) {
    for (const owned of created.reverse()) {
      try {
        const stat = await fs.lstat(owned.path)
        if (stat.ino === owned.ino && stat.dev === owned.dev)
          await fs.unlink(owned.path)
      } catch (cleanupError) {
        if (!missing(cleanupError))
          throw new AggregateError(
            [error, cleanupError],
            'Import and rollback failed',
            { cause: cleanupError },
          )
      }
    }
    throw error
  } finally {
    await cleanup()
  }
  async function cleanup() {
    if (staging) await fs.rm(staging, { recursive: true, force: true })
    // Only remove directories created by this run, and only if still empty.
    for (const directory of directories.reverse()) {
      try {
        await fs.rmdir(directory)
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          ['ENOTEMPTY', 'ENOENT'].includes(String(error.code))
        ))
          throw error
      }
    }
  }
}
