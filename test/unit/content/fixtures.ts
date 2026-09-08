import inventory from '../../../docs/migration/inventory.json'
import legacy from '../../../docs/migration/legacy-urls.json'
import timings from '../../../docs/migration/track-timings.json'
import correction from '../../../docs/milestones/evidence/M02-praxis-duration.json'
import { createCandidate, readSources } from '../../../tools/content/source.ts'
import type { Catalog } from '../../../shared/content/schema.ts'
import { rssSettingsSchema } from '../../../shared/content/schema.ts'

const hashes = (await readSources()).hashes
export const sources = () =>
  structuredClone({ inventory, legacy, timings, correction, hashes })
export const candidate = createCandidate(sources())
export const catalog = () => structuredClone(candidate.catalog)
export const rssSettings = () =>
  rssSettingsSchema.parse({
    language: 'en-US',
    category: 'Music',
    author: 'nurevolution studios',
    explicit: false,
    subtitle: 'Austin DJ/Producers Trey Turner & friends',
    copyright: 'Copyright © nurevolution studios 2026',
    owner: { name: 'nurevolution studios', email: 'tturner@nurevolution.net' },
  })
export function runnableCatalog() {
  const value = catalog()
  value.show.rss = rssSettings()
  return value
}
export function documents(value: Catalog) {
  return {
    show: value.show,
    assets: { schemaVersion: 1, assets: value.assets },
    legacyUrls: { schemaVersion: 1, entries: value.legacyUrls },
    episodes: value.episodes.map((e) => ({
      file: `episodes/${e.id}.json`,
      value: e,
    })),
  }
}
export const reader = () => ({
  async list() {
    return [...candidate.files.keys()]
  },
  async read(path: string): Promise<unknown> {
    return path === 'show.json'
      ? runnableCatalog().show
      : JSON.parse(candidate.files.get(path)!)
  },
})
