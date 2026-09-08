import { feedAliasResponse, isFeedAlias } from '../rss/http.ts'

export default defineEventHandler((event) => {
  if (!isFeedAlias(getRequestURL(event))) return
  const response = feedAliasResponse(event.method)
  setResponseStatus(event, response.status)
  setResponseHeaders(event, response.headers)
  return response.body
})
