import show from '../../content/show.json'
import assets from '../../content/assets.json'
import legacyUrls from '../../content/legacy-urls.json'
import { validateCatalog } from '../../server/content/validate'

export const archiveCatalog = validateCatalog({
  show,
  assets,
  legacyUrls,
  episodes: Object.entries(
    import.meta.glob('../../content/episodes/*.json', {
      eager: true,
      import: 'default',
    }),
  ).map(([path, value]) => ({
    file: path.replace('../../content/', ''),
    value,
  })),
})
