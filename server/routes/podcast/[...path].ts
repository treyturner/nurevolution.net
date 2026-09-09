import { createLegacyResponder } from '../../pages/legacy'
import { contentRepository } from '../../utils/content'
const respond = createLegacyResponder((path, asOf) =>
  contentRepository.legacyPath(path, asOf),
)
export default defineEventHandler(async (event) => {
  const response = await respond(event.method, getRequestURL(event).pathname)
  setResponseStatus(event, response.status)
  setResponseHeaders(event, response.headers)
  return response.body
})
