// XML 1.0 permits supplementary characters, but never isolated UTF-16 surrogates.
export function isXmlText(value: string): boolean {
  return !/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(value)
}
