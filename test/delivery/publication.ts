import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { readCatalog } from '../../server/content/repository.ts'
import { fileReader } from '../../tools/content/files.ts'
import { serialize } from '../../tools/deploy/manifest.ts'
import type { Execute } from '../../tools/deploy/host.ts'

/** The exact app image must serve an added episode from an external snapshot. */
export async function verifyPublicationRuntime(
  image: string,
  container: string,
  volume: string,
  directory: string,
  docker: (args: string[]) => Promise<string>,
  run: Execute,
) {
  const snapshot = resolve(directory, 'publication')
  await fs.cp('.output/publication', snapshot, { recursive: true })
  const { catalog } = await readCatalog(
    fileReader(resolve(snapshot, 'content')),
  )
  const original = catalog.episodes.find((e) => e.id === 'wp-484')!
  const audio = structuredClone(
    catalog.assets.find((a) => a.id === original.audioAssetId)!,
  )
  audio.id = 'publication-test-audio'
  audio.relativePath = 'publication-test.mp3'
  audio.url = 'https://podcast.nurevolution.net/publication-test.mp3'
  const episode = {
    ...original,
    id: 'publication-test',
    slug: 'publication-test',
    title: 'Publication recovery fixture',
    guid: 'urn:publication-test',
    audioAssetId: audio.id,
    explicit: true,
  }
  catalog.assets.push(audio)
  await fs.writeFile(
    resolve(snapshot, 'content/assets.json'),
    serialize({ schemaVersion: 1, assets: catalog.assets }),
  )
  await fs.writeFile(
    resolve(snapshot, 'content/episodes/publication-test.json'),
    serialize(episode),
  )
  const playbackFile = resolve(snapshot, 'playback/manifest.json')
  const playback = JSON.parse(await fs.readFile(playbackFile, 'utf8'))
  playback.entries.push({
    ...playback.entries.find(
      (e: { assetId: string }) => e.assetId === original.audioAssetId,
    ),
    assetId: audio.id,
  })
  await fs.writeFile(playbackFile, serialize(playback))
  // A named volume works even when the daemon cannot bind workstation paths.
  await docker([
    'create',
    '--name',
    container,
    '--network',
    'none',
    '--read-only',
    '--memory',
    '384m',
    '--memory-swap',
    '384m',
    '--pids-limit',
    '64',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '-v',
    volume + ':/publication:ro',
    '-e',
    'NUXT_PUBLICATION_ROOT=/publication/snapshot',
    image,
  ])
  try {
    const seed = container + '-seed'
    await docker([
      'create',
      '--name',
      seed,
      '-v',
      volume + ':/publication',
      image,
    ])
    try {
      await docker(['cp', snapshot, seed + ':/publication/snapshot'])
    } finally {
      await docker(['rm', '-f', seed])
    }
    await docker(['start', container])
    const script = `
      const get = async path => {
        let response;
        for(let i=0;i<30;i++) {
          try { response=await fetch('http://127.0.0.1:3000'+path); if(response.ok) return response; } catch {}
          await new Promise(r=>setTimeout(r,500));
        }
        throw Error('Snapshot route failed: '+path+' status '+response?.status);
      };
      const list=(await (await get('/api/episodes')).json()).episodes;
      if(list.length!==${catalog.episodes.filter((e) => e.status === 'published').length + 1}) throw Error('External episode not listed');
      const d=await (await get('/api/episodes/publication-test')).json();
      if(d.guid!=='urn:publication-test'||!d.explicit||d.audio.url!==${JSON.stringify(audio.url)}) throw Error('External episode identity/rating lost');
      const feed=await (await get('/feed/podcast')).text();
      if(!feed.includes('urn:publication-test')) throw Error('External episode missing from RSS');
      await get('/episodes/publication-test');
      const chapters=await (await get('/chapters/publication-test.json')).json();
      if(chapters.chapters.length!==${original.tracks.filter((t) => t.startTime !== null).length}) throw Error('Chapters missing');
      const r=await get(${JSON.stringify('/episode-artwork/v1-' + catalog.assets.find((a) => a.id === original.artworkAssetId)!.sha256 + '.jpg')});
      if(r.headers.get('content-type')!=='image/jpeg') throw Error('External artwork missing');
      const thumb=await get(d.artworkThumbnailUrl);
      if(thumb.headers.get('content-type')!=='image/webp') throw Error('External thumbnail missing');
      if((await fetch('http://127.0.0.1:3000/content/assets.json')).status!==404) throw Error('Private catalog exposed');
      if((await fetch('http://127.0.0.1:3000/episode-artwork/v1-'+ '0'.repeat(64)+'.jpg')).status!==404) throw Error('Unknown image exposed');
      console.log('external publication passed');
    `
    assert.equal(
      await run('docker', [
        'exec',
        container,
        'node',
        '--input-type=module',
        '-e',
        script,
      ]),
      'external publication passed',
    )
  } finally {
    await docker(['rm', '-f', container])
  }
}
