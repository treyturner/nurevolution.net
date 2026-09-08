import sanitizeHtml from 'sanitize-html'
import { urlSchema } from '../../shared/content/schema.ts'

const allowedTags = [
  'p',
  'br',
  'a',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'blockquote',
]
const options = {
  allowedTags,
  allowedAttributes: { a: ['href', 'title'] },
  allowedSchemes: ['http', 'https'],
  allowProtocolRelative: false,
}

export function normalizeDescription(html: string): string {
  return sanitizeHtml(html, options).trim()
}

function textContent(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(
    /\s+/g,
    '',
  )
}

export function importDescription(
  html: string,
  databaseHtml: string,
  episodeId: string,
) {
  if (!html.trim())
    throw new Error(
      `${episodeId}: empty feedContentHtml requires a reviewed fallback`,
    )
  const changes = new Set<string>()
  const prepared = sanitizeHtml(html, {
    ...options,
    transformTags: {
      img: (tagName, attribs) => {
        if (
          episodeId !== 'wp-269' ||
          attribs.class !== 'wp-smiley' ||
          attribs.alt !== '😀'
        )
          throw new Error(`${episodeId}: unreviewed description image`)
        return { tagName, attribs, text: '😀' }
      },
      '*': (tagName, attribs) => {
        if (
          episodeId === 'wp-269' &&
          tagName === 'img' &&
          attribs.class === 'wp-smiley' &&
          attribs.alt === '😀'
        ) {
          changes.add('WordPress smiley image replaced with 😀 text')
          return { tagName: 'span', attribs: {}, text: '😀' }
        }
        if (!allowedTags.includes(tagName))
          throw new Error(`${episodeId}: unreviewed description tag ${tagName}`)
        for (const key of Object.keys(attribs)) {
          if (key === 'style') changes.add('Removed inline styling')
          else if (!(tagName === 'a' && ['href', 'title'].includes(key)))
            throw new Error(
              `${episodeId}: unreviewed description attribute ${key}`,
            )
        }
        if (
          tagName === 'a' &&
          attribs.href &&
          !urlSchema.safeParse(attribs.href).success
        ) {
          throw new Error(`${episodeId}: unreviewed description link`)
        }
        return { tagName, attribs }
      },
    },
  }).trim()
  const normalized = normalizeDescription(prepared)
  let databaseText = textContent(databaseHtml).replace(
    episodeId === 'wp-269' ? ':D' : /$^/,
    '😀',
  )
  if (['wp-428', 'wp-444'].includes(episodeId)) {
    databaseText = databaseText.replaceAll("'", '’')
    changes.add(
      'Preserved WordPress typographic apostrophes from full feed content',
    )
  }
  if (textContent(normalized) !== databaseText)
    throw new Error(
      `${episodeId}: unexplained full feed/database description difference`,
    )
  if (html !== normalized)
    changes.add('Canonical HTML serialization and surrounding whitespace')
  return { html: normalized, changes: [...changes].sort() }
}
