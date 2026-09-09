import { createDownloadResponder } from '../../../../../../server/downloads/response'
import { downloadHandler } from '../../../../../../server/downloads/handler'
import { playerEpisodes } from '../../../data/player'

export default defineEventHandler((event) => {
  const origin = getRequestURL(event).origin
  const respond = createDownloadResponder(
    async (slug) =>
      playerEpisodes(origin).find((episode) => episode.slug === slug),
    { origin },
  )
  return downloadHandler(respond)(event)
})
