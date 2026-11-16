import { createContentRepository } from '../content/repository.ts'
import { resolve } from 'node:path'
import { publicationReader, publicationRoot } from './publication.ts'

export const contentRepository = createContentRepository(
  publicationRoot()
    ? publicationReader(resolve(publicationRoot(), 'content'))
    : {
        async list() {
          return (await useStorage('assets:content').getKeys()).map((key) =>
            key.replaceAll(':', '/'),
          )
        },
        async read(path) {
          return useStorage('assets:content').getItem(path)
        },
      },
  !import.meta.dev,
)
