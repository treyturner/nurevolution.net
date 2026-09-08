import { contentRepository } from '../../utils/content.ts'

export default defineEventHandler(async (event) => {
  const episode = await contentRepository.find(
    getRouterParam(event, 'slug') ?? '',
    Date.now(),
  )
  if (!episode)
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  return episode
})
