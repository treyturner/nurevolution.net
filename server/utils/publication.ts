import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { relativePathSchema } from '../../shared/content/schema.ts'
import type { DocumentReader } from '../content/repository.ts'

export function publicationRoot() {
  return process.env.NUXT_PUBLICATION_ROOT || ''
}

export function publicationReader(root: string): DocumentReader {
  return {
    async list() {
      const files = await readdir(root, {
        recursive: true,
        withFileTypes: true,
      })
      return files
        .filter((f) => f.isFile())
        .map((f) => {
          const path = resolve(f.parentPath, f.name).slice(
            resolve(root).length + 1,
          )
          return relativePathSchema.parse(path)
        })
    },
    async read(path) {
      relativePathSchema.parse(path)
      return JSON.parse(await readFile(resolve(root, path), 'utf8')) as unknown
    },
  }
}

export function publicationFile(path: string) {
  relativePathSchema.parse(path)
  const root = publicationRoot()
  if (!root) throw new Error('No publication snapshot configured')
  return readFile(resolve(root, path))
}
