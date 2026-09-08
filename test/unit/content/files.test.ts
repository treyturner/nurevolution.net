import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertNoSymlinks,
  fileReader,
  listFiles,
  reconcileFiles,
} from '../../../tools/content/files.ts'
import { isMain, parseArguments, runCli } from '../../../tools/content/cli.ts'
import { importWordpress } from '../../../tools/content/import-wordpress.ts'
import { checkContent, protectHistory } from '../../../tools/content/check.ts'
import {
  inputPaths,
  projectRoot,
  readSources,
} from '../../../tools/content/source.ts'
import { candidate, catalog } from './fixtures.ts'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(resolve(tmpdir(), 'nurevolution-m2-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('create-only filesystem imports', () => {
  const files = new Map([
    ['show.json', '{}\n'],
    ['episodes/example.json', '{"example":true}\n'],
  ])
  it('does not write on dry run, creates missing files, and leaves identical files untouched', async () => {
    const output = resolve(root, 'nested/content')
    expect(await reconcileFiles(files, output, [], false)).toMatchObject({
      create: [...files.keys()],
      identical: [],
      conflicts: [],
    })
    expect(await listFiles(output)).toEqual([])
    await reconcileFiles(files, output, [], true)
    const stat = await fs.stat(resolve(output, 'show.json'))
    expect(await reconcileFiles(files, output, [], true)).toEqual({
      create: [],
      identical: [...files.keys()],
      conflicts: [],
    })
    expect((await fs.stat(resolve(output, 'show.json'))).mtimeMs).toBe(
      stat.mtimeMs,
    )
    expect(await fileReader(output).read('episodes/example.json')).toEqual({
      example: true,
    })
    expect(await listFiles(output)).toEqual([
      'episodes/example.json',
      'show.json',
    ])
  })
  it('detects all changed and unknown files before writing anything', async () => {
    await fs.writeFile(resolve(root, 'show.json'), 'hand edit')
    await fs.writeFile(resolve(root, 'notes.txt'), 'keep')
    const result = await reconcileFiles(files, root, [], true)
    expect(result.conflicts).toEqual(['show.json', 'notes.txt'])
    expect(await listFiles(root)).toEqual(['notes.txt', 'show.json'])
    expect(await fs.readFile(resolve(root, 'show.json'), 'utf8')).toBe(
      'hand edit',
    )
  })
  it('rejects output/input overlap, traversal, symlink files and symlink ancestors', async () => {
    await expect(reconcileFiles(files, root, [root], true)).rejects.toThrow(
      'overlaps',
    )
    await expect(
      reconcileFiles(files, resolve(root, 'inside'), [root], true),
    ).rejects.toThrow('overlaps')
    await expect(
      reconcileFiles(files, root, [resolve(root, 'inside')], true),
    ).rejects.toThrow('overlaps')
    await expect(
      reconcileFiles(new Map([['../escape', 'bad']]), root, [], true),
    ).rejects.toThrow()
    await fs.mkdir(resolve(root, 'real'))
    await fs.symlink(resolve(root, 'real'), resolve(root, 'link'))
    await expect(
      reconcileFiles(files, resolve(root, 'link/content'), [], true),
    ).rejects.toThrow('Symlink')
    await expect(listFiles(root)).rejects.toThrow('Unsupported content')
    await expect(fileReader(root).read('link/a')).rejects.toThrow('Symlink')
    await fs.writeFile(resolve(root, 'plain'), 'not directory')
    await expect(listFiles(resolve(root, 'plain'))).rejects.toThrow()
    await expect(
      assertNoSymlinks(resolve(root, 'plain/child')),
    ).rejects.toThrow()
  })
  it('rolls back only its own new files when a concurrent creator wins a destination', async () => {
    const output = resolve(root, 'content')
    const link = vi.fn(async (source: string, target: string) => {
      if (target.endsWith('example.json'))
        await fs.writeFile(target, 'concurrent writer')
      await fs.link(source, target)
    })
    await expect(
      reconcileFiles(files, output, [], true, link),
    ).rejects.toThrow()
    expect(await listFiles(output)).toEqual(['episodes/example.json'])
    expect(
      await fs.readFile(resolve(output, 'episodes/example.json'), 'utf8'),
    ).toBe('concurrent writer')
  })
  it('rolls back new directories and retains preexisting files after an I/O failure', async () => {
    await expect(
      reconcileFiles(
        files,
        resolve(root, 'new/content'),
        [],
        true,
        async () => {
          throw new Error('disk error')
        },
      ),
    ).rejects.toThrow('disk error')
    expect(await fs.readdir(root)).toEqual([])
    await fs.writeFile(resolve(root, 'show.json'), files.get('show.json')!)
    await expect(
      reconcileFiles(files, root, [], true, async () => {
        throw new Error('disk error')
      }),
    ).rejects.toThrow('disk error')
    expect(await fs.readFile(resolve(root, 'show.json'), 'utf8')).toBe(
      files.get('show.json'),
    )
  })
})

describe('CLI and historical compatibility', () => {
  it('runs dry-run/write/check modes with documented exit codes and complete reproducibility', async () => {
    const output = resolve(root, 'archive'),
      other = resolve(root, 'other'),
      print = vi.fn()
    expect(await importWordpress(['--output', output], print)).toBe(0)
    expect(await listFiles(output)).toEqual([])
    expect(await importWordpress(['--check', '--output', output], print)).toBe(
      2,
    )
    expect(await importWordpress(['--write', '--output', output], print)).toBe(
      0,
    )
    expect(await importWordpress(['--write', '--output', other], print)).toBe(0)
    for (const path of await listFiles(output))
      expect(await fs.readFile(resolve(output, path), 'utf8')).toBe(
        await fs.readFile(resolve(other, path), 'utf8'),
      )
    expect(await importWordpress(['--check', '--output', output], print)).toBe(
      0,
    )
    expect(await checkContent(['--output', output], print)).toBe(0)
    await fs.writeFile(resolve(output, 'show.json'), 'edited')
    expect(await importWordpress(['--write', '--output', output], print)).toBe(
      2,
    )
    expect(
      await runCli(() => checkContent(['--output', output], print), print),
    ).toBe(1)
    expect(await fs.readFile(resolve(output, 'show.json'), 'utf8')).toBe(
      'edited',
    )
  })
  it('permits valid new episodes and editorial changes without weakening historical protections', () => {
    const current = catalog(),
      old = current.episodes[0]!
    old.title = 'Editorial correction'
    old.descriptionHtml = '<p>Corrected notes</p>'
    old.tracks = []
    current.episodes.push({
      ...old,
      id: 'new-episode',
      slug: 'new-episode',
      guid: 'urn:new:episode',
      status: 'draft',
      publishedAt: null,
    })
    expect(() =>
      protectHistory(current, candidate.report, candidate),
    ).not.toThrow()
    for (const key of [
      'id',
      'slug',
      'status',
      'guid',
      'guidIsPermalink',
      'publishedAt',
      'audioAssetId',
    ] as const) {
      const changed = catalog()
      Object.assign(changed.episodes[0]!, {
        [key]: key === 'guidIsPermalink' ? true : 'changed',
      })
      expect(() =>
        protectHistory(changed, candidate.report, candidate),
      ).toThrow()
    }
    for (const key of [
      'url',
      'mediaType',
      'byteLength',
      'sha256',
      'id',
    ] as const) {
      const changed = catalog(),
        audio = changed.assets.find(
          (a) => a.id === changed.episodes[0]!.audioAssetId,
        )!
      Object.assign(audio, { [key]: key === 'byteLength' ? 1 : 'changed' })
      expect(() =>
        protectHistory(changed, candidate.report, candidate),
      ).toThrow('protected audio')
    }
    const changed = catalog()
    changed.legacyUrls.pop()
    expect(() => protectHistory(changed, candidate.report, candidate)).toThrow(
      'Protected legacy',
    )
    expect(() =>
      protectHistory(
        catalog(),
        { ...candidate.report, sourceSnapshotId: 'changed' },
        candidate,
      ),
    ).toThrow('provenance changed')
  })
  it('requires exact frozen source hashes, including supplemental evidence', async () => {
    for (const path of Object.values(inputPaths)) {
      await fs.mkdir(resolve(root, path, '..'), { recursive: true })
      await fs.copyFile(resolve(projectRoot, path), resolve(root, path))
    }
    expect((await readSources(root)).hashes).toEqual(
      candidate.report.sourceHashes,
    )
    await fs.appendFile(resolve(root, inputPaths.correction), '\n')
    await expect(readSources(root)).rejects.toThrow('frozen input hash changed')
  })
  it('handles option errors and CLI failure reporting without coercion', async () => {
    expect(parseArguments([], true)).toEqual({
      output: 'content',
      mode: 'dry-run',
    })
    for (const args of [
      ['--force'],
      ['--write', '--check'],
      ['--check', '--check'],
      ['--output'],
      ['--output', '--check'],
      ['--output', 'a', '--output', 'b'],
    ])
      expect(() => parseArguments(args, true)).toThrow()
    expect(() => parseArguments(['--write'], false)).toThrow()
    const print = vi.fn()
    expect(await runCli(async () => 2, print)).toBe(2)
    expect(
      await runCli(async () => {
        throw new Error('bad', { cause: new Error('detail') })
      }, print),
    ).toBe(1)
    expect(print).toHaveBeenLastCalledWith('bad: detail')
    expect(
      await runCli(async () => {
        throw 'problem'
      }, print),
    ).toBe(1)
    expect(print).toHaveBeenLastCalledWith('problem')
    expect(isMain(import.meta.url)).toBe(false)
  })
})
