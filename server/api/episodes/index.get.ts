import { contentRepository } from '../../utils/content.ts'

export default defineEventHandler(async () => ({
  episodes: await contentRepository.list(Date.now()),
}))
