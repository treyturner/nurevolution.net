export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'audio/mpeg')
  return useStorage('assets:playback-test').getItemRaw<Uint8Array>('seek.mp3')
})
