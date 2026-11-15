import * as fs from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileReader, listFiles } from '../content/files.ts'
import { readCatalog } from '../../server/content/repository.ts'
import { validatePlayback } from '../../server/playback/index.ts'
import { createManifest, serialize, sha256 } from './manifest.ts'
import {
  readRelease,
  effectiveManifest,
  publicationRelease,
  type PublicationRelease,
  type DeploymentRecord,
} from './release.ts'

/** Run inside an isolated fallback container before changing the public app. */
export function publicationProbe(record: DeploymentRecord) {
  const manifest = effectiveManifest(record)
  return `
    const expected = ${JSON.stringify(manifest.episodes)};
    const get = async path => {
      const r = await fetch('http://127.0.0.1:3000' + path, {signal: AbortSignal.timeout(10000)});
      if (!r.ok) throw new Error('Publication probe failed: ' + path);
      return r;
    };
    const health = await (await get('/api/health')).json();
    if (health.release !== ${JSON.stringify(record.release.sourceCommit)}) throw new Error('Fallback code identity mismatch');
    const list = (await (await get('/api/episodes')).json()).episodes;
    if (list.length !== expected.length) throw new Error('Publication list mismatch');
    const feed = await (await get('/feed/podcast')).text();
    const xml = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
    if ((feed.match(/<item>/g) || []).length !== expected.length) throw new Error('Publication feed mismatch');
    for (const e of expected) {
      if (!list.some(x => x.slug === e.slug)) throw new Error('Missing published episode');
      const d = await (await get('/api/episodes/' + e.slug)).json();
      if (d.guid !== e.guid || d.guidIsPermalink !== e.guidIsPermalink || d.audio.url !== e.enclosure || d.audio.byteLength !== e.byteLength || d.audio.mediaType !== e.mediaType) throw new Error('Subscriber identity mismatch');
      if (!feed.includes(xml(e.guid)) || !feed.includes(xml(e.enclosure))) throw new Error('Missing feed identity');
      await (await get('/episodes/' + e.slug)).arrayBuffer();
      await (await get(d.artworkThumbnailUrl)).arrayBuffer();
      if (d.tracks.some(t => t.startTime !== null)) await (await get('/chapters/' + e.slug + '.json')).json();
    }
    for (const path of ${JSON.stringify(
      publicationRelease(record)
        .configuration.publication?.files.filter((f) =>
          f.path.startsWith('public/'),
        )
        .map((f) => '/' + f.path.slice(7)) ?? [],
    )}) await (await get(path)).arrayBuffer();
  `
}

/** Copied into the tested image, then extracted by digest on the host. */
export async function preparePublication(destination: string) {
  await fs.mkdir(destination, { recursive: true })
  const existing = await listFiles(destination)
  const files: { path: string; sha256: string }[] = []
  for (const root of [
    'content',
    'playback',
    'public/episode-artwork',
    'public/artwork-thumbnails',
  ]) {
    for (const name of await listFiles(root)) {
      const path = root + '/' + name
      const bytes = await fs.readFile(path)
      await fs.mkdir(dirname(resolve(destination, path)), { recursive: true })
      if (existing.includes(path)) {
        if (
          sha256(await fs.readFile(resolve(destination, path))) !==
          sha256(bytes)
        )
          throw new Error(
            'Publication output differs; rebuild the application before packaging',
          )
      } else
        await fs.writeFile(resolve(destination, path), bytes, {
          flag: 'wx',
          mode: 0o644,
        })
      files.push({ path, sha256: sha256(bytes) })
    }
  }
  if (existing.some((path) => !files.some((file) => file.path === path)))
    throw new Error('Unexpected publication output')
  return {
    version: 1 as const,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  }
}

/** Reject partial extractions, symlinks, altered bytes, and mismatched catalogs. */
export async function verifyPublication(
  root: string,
  publication: PublicationRelease,
) {
  const { configuration, manifest } = readRelease(
    publication.release,
    serialize(publication.manifest),
    serialize(publication.configuration),
  )
  if (!configuration.publication)
    throw new Error('Release lacks publication support')
  const expected = configuration.publication.files
  const names = expected.map((f) => f.path).sort()
  if (
    new Set(names).size !== names.length ||
    serialize(await listFiles(root)) !== serialize(names)
  )
    throw new Error('Incomplete publication snapshot')
  for (const file of expected)
    if (sha256(await fs.readFile(resolve(root, file.path))) !== file.sha256)
      throw new Error(`Publication checksum mismatch: ${file.path}`)
  const { catalog } = await readCatalog(fileReader(resolve(root, 'content')))
  const generated = createManifest(
    catalog,
    manifest.sourceCommit,
    manifest.asOf,
    manifest.assets.filter((e) => e.public).map((e) => e.asset),
  )
  if (serialize(generated) !== serialize(manifest))
    throw new Error('Publication catalog differs from release manifest')
  validatePlayback(
    JSON.parse(
      await fs.readFile(resolve(root, 'playback/manifest.json'), 'utf8'),
    ),
    catalog.assets,
  )
}
