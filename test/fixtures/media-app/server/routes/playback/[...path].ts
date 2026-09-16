import { playbackHandler } from '../../../../../../server/playback/handler'
import { createHeaderCache } from '../../../../../../server/playback/index'
import {
  playbackEntrySchema,
  playbackPath,
} from '../../../../../../shared/playback/schema'
import fixture from '../../../../playback/fixture.json'

const entry = playbackEntrySchema.parse(fixture.entry)
const header = createHeaderCache(async (name) => {
  return (await useStorage('assets:playback-test').getItemRaw<Uint8Array>(
    name,
  ))!
})
export default playbackHandler(() => ({
  root: useRuntimeConfig().audioRoot,
  find: async (path) =>
    path === playbackPath(entry)
      ? {
          entry,
          asset: {
            ...fixture.asset,
            kind: 'audio',
            sourceRoot: 'audio',
            mediaType: 'audio/mpeg',
          },
        }
      : undefined,
  header,
}))
