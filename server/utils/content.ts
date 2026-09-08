import { createContentRepository } from '../content/repository.ts'

export const contentRepository = createContentRepository(
  {
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
