import { contentRepository } from '../utils/content.ts'

export default defineEventHandler(() => contentRepository.show())
