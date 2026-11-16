/** Change browser delivery hosts without changing canonical content or RSS. */
export function deliveryAssetUrl(
  url: string,
  kind: 'artwork' | 'audio',
  origin: string,
  development = false,
) {
  const canonical =
    kind === 'artwork'
      ? 'https://nurevolution.net'
      : 'https://podcast.nurevolution.net'
  if (!url.startsWith(canonical + '/')) return url
  if (origin) return origin + url.slice(canonical.length)
  return development
    ? `/__dev/assets/${kind}${url.slice(canonical.length)}`
    : url
}
