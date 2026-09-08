import { isXmlText } from '../../shared/content/xml.ts'

function checked(value: string, field: string) {
  if (!isXmlText(value)) throw new Error(`${field}: invalid XML 1.0 character`)
  return value
}

export function xmlText(value: string, field: string) {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\r': '&#13;',
  }
  return checked(value, field).replace(
    /[&<>\r]/g,
    (character) => entities[character]!,
  )
}

export function xmlAttribute(value: string, field: string) {
  const entities: Record<string, string> = {
    '"': '&quot;',
    "'": '&apos;',
    '\t': '&#9;',
    '\n': '&#10;',
  }
  return xmlText(value, field).replace(
    /["'\t\n]/g,
    (character) => entities[character]!,
  )
}

export function xmlCdata(value: string, field: string) {
  return `<![CDATA[${checked(value, field).replaceAll(']]>', ']]]]><![CDATA[>').replaceAll('\r', ']]>&#13;<![CDATA[')}]]>`
}
