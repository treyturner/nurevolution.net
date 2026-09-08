import {
  relativePathSchema,
  reportSchema,
  type Catalog,
} from '../../shared/content/schema.ts'
import {
  episodeDetail,
  episodeSummary,
  selectPublic,
  showPublic,
} from '../../shared/content/public.ts'
import { parseContentFile, validateCatalog } from './validate.ts'

export interface DocumentReader {
  list(): Promise<string[]>
  read(path: string): Promise<unknown>
}

export async function readCatalog(
  reader: DocumentReader,
  authoringAsOf?: number,
) {
  const paths = (await reader.list()).sort()
  for (const path of paths) {
    relativePathSchema.parse(path)
    if (
      ![
        'show.json',
        'assets.json',
        'legacy-urls.json',
        'wordpress-import.json',
      ].includes(path) &&
      !/^episodes\/[a-z0-9-]+\.json$/.test(path)
    )
      throw new Error(`Unexpected content file: ${path}`)
  }
  const read = async (path: string) => {
    if (!paths.includes(path)) throw new Error(`Missing content file: ${path}`)
    try {
      return await reader.read(path)
    } catch (error) {
      throw new Error(`${path}: cannot read content`, { cause: error })
    }
  }
  const [show, assets, legacyUrls, report, episodes] = await Promise.all([
    read('show.json'),
    read('assets.json'),
    read('legacy-urls.json'),
    read('wordpress-import.json'),
    Promise.all(
      paths
        .filter((path) => path.startsWith('episodes/'))
        .map(async (file) => ({ file, value: await read(file) })),
    ),
  ])
  const catalog = validateCatalog(
    { show, assets, legacyUrls, episodes },
    authoringAsOf,
  )
  return {
    catalog,
    report: parseContentFile(reportSchema, report, 'wordpress-import.json'),
  }
}

export function createContentRepository(
  reader: DocumentReader,
  cache: boolean,
) {
  let cached: Promise<Catalog> | undefined
  function load(): Promise<Catalog> {
    if (!cache) return readCatalog(reader).then((value) => value.catalog)
    cached ??= readCatalog(reader)
      .then((value) => value.catalog)
      .catch((error: unknown) => {
        cached = undefined
        throw error
      })
    return cached
  }
  return {
    async show() {
      return showPublic(await load())
    },
    async list(asOf: number) {
      const catalog = await load()
      return selectPublic(catalog, asOf).map((e) => episodeSummary(catalog, e))
    },
    async find(slug: string, asOf: number) {
      const catalog = await load()
      const episode = selectPublic(catalog, asOf).find((e) => e.slug === slug)
      return episode ? episodeDetail(catalog, episode) : undefined
    },
    async publicArchive(asOf: number) {
      const catalog = await load()
      return {
        show: showPublic(catalog),
        episodes: selectPublic(catalog, asOf).map((e) =>
          episodeDetail(catalog, e),
        ),
      }
    },
  }
}
