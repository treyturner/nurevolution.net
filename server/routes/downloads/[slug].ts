import { createDownloadResponder } from '../../downloads/response'
import { downloadHandler } from '../../downloads/handler'
import { contentRepository } from '../../utils/content'

export default downloadHandler(
  createDownloadResponder((slug, asOf) => contentRepository.find(slug, asOf)),
)
