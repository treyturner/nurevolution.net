/** Change browser delivery hosts without changing canonical content or RSS. */
export function deliveryAssetUrl(
  url: string,
  kind: 'artwork' | 'audio',
  origin: string,
) {
  const canonical =
    kind === 'artwork'
      ? 'https://nurevolution.net'
      : 'https://podcast.nurevolution.net'
  return origin && url.startsWith(canonical + '/')
    ? origin + url.slice(canonical.length)
    : url
}
