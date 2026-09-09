import { contentRepository } from '../utils/content.ts'
import { healthStatus } from '../health/status.ts'

export default defineEventHandler(async (event) => {
  const result = await healthStatus(
    () => contentRepository.show(),
    process.env.NUREVOLUTION_RELEASE ?? 'development',
  )
  setResponseStatus(event, result.status)
  setHeader(event, 'Cache-Control', 'no-store')
  return result.body
})
