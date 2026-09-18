import { createChapterResponder } from '../../chapters/http.ts'
import { contentRepository } from '../../utils/content.ts'

const respond = createChapterResponder((slug, asOf) =>
  contentRepository.find(slug, asOf),
)

export default defineEventHandler(async (event) => {
  // Version hints refresh clients; every hint resolves the current public data.
  const file = getRouterParam(event, 'file') ?? ''
  const slug = file.endsWith('.json') ? file.slice(0, -5) : ''
  const response = await respond(
    slug,
    event.method,
    getRequestHeader(event, 'if-none-match'),
  )
  setResponseStatus(event, response.status)
  setResponseHeaders(event, response.headers)
  return response.body
})
