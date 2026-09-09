export function attachment(filename: string) {
  if (
    !filename ||
    filename === '.' ||
    filename === '..' ||
    /[/\\]/.test(filename) ||
    [...filename].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw new Error('Invalid download basename')
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replaceAll('"', '\\"')
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
