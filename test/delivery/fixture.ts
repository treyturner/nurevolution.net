import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readCatalog } from '../../server/content/repository.ts'
import { fileReader } from '../../tools/content/files.ts'
import { createManifest, sha256 } from '../../tools/deploy/manifest.ts'

export async function deliveryFixture(directory: string, commit: string) {
  const { catalog } = await readCatalog(fileReader('content'))
  const mp3 = await readFile('test/fixtures/media-app/public/sample.mp3')
  // Original one-pixel PNG, independently generated for delivery checks.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6S8AAAAASUVORK5CYII=',
    'base64',
  )
  const names = ['test-tone.mp3', "bouche_d'incendie.mp3", 'musique-étoile.mp3']
  const audio = names.map((name, index) => ({
    id: `audio-${index}`,
    kind: 'audio' as const,
    mediaType: 'audio/mpeg' as const,
    url: 'https://podcast.nurevolution.net/' + encodeURI(name),
    sourceRoot: 'audio' as const,
    relativePath: name,
    byteLength: mp3.length,
    sha256: sha256(mp3),
  }))
  const artwork = {
    id: 'cover',
    kind: 'artwork' as const,
    mediaType: 'image/png' as const,
    url: 'https://nurevolution.net/wp/wp-content/uploads/cover.png',
    sourceRoot: 'uploads' as const,
    relativePath: 'cover.png',
    byteLength: png.length,
    sha256: sha256(png),
  }
  catalog.episodes = ['first', 'second', 'third'].map((slug, index) => ({
    ...catalog.episodes[0]!,
    id: slug,
    slug,
    audioAssetId: audio[index]!.id,
    artworkAssetId: artwork.id,
    guid: slug,
  }))
  catalog.assets = [...audio, artwork]
  catalog.show.standardArtworkAssetId = artwork.id
  catalog.show.itunesArtworkAssetId = artwork.id
  await mkdir(resolve(directory, 'audio'), { recursive: true })
  await mkdir(resolve(directory, 'uploads'), { recursive: true })
  for (const name of names)
    await writeFile(resolve(directory, 'audio', name), mp3)
  await writeFile(resolve(directory, 'uploads/cover.png'), png)
  await writeFile(resolve(directory, 'private.json'), 'must never be public')
  return {
    manifest: createManifest(catalog, commit, '2026-09-09T00:00:00.000Z'),
    names,
    mp3,
    png,
  }
}
