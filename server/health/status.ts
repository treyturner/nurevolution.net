export async function healthStatus(
  load: () => Promise<unknown>,
  release: string,
) {
  try {
    if (release !== 'development' && !/^[a-f0-9]{40}$/.test(release))
      throw new Error('Invalid release')
    await load()
    return { status: 200, body: { healthy: true, release } }
  } catch {
    return { status: 503, body: { healthy: false } }
  }
}
