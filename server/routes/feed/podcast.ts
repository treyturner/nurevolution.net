import { createFeedResponder } from '../../rss/http.ts'
import { contentRepository } from '../../utils/content.ts'

const respond = createFeedResponder((asOf) =>
  contentRepository.publicArchive(asOf),
)

export default defineEventHandler(async (event) => {
  const response = await respond(
    event.method,
    getRequestHeader(event, 'if-none-match'),
  )
  setResponseStatus(event, response.status)
  setResponseHeaders(event, response.headers)
  return response.body
})
