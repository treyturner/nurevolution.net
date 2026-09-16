import { contentRepository } from '../../utils/content.ts'
import { playbackDescriptor } from '../../utils/playback.ts'

export default defineEventHandler(async (event) => {
  const episode = await contentRepository.find(
    getRouterParam(event, 'slug') ?? '',
    Date.now(),
  )
  if (!episode)
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  episode.audio.playback = await playbackDescriptor(episode.audio.url)
  return episode
})
