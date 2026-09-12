import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('edge attachment redirect saves exact bytes and filenames while the shared player stays paused', async ({
  page,
}) => {
  const origin = process.env.DELIVERY_WEB_ORIGIN!
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.url()))
  const bytes = await readFile('test/fixtures/media-app/public/sample.mp3')
  await page.goto(origin + '/player-test')
  for (const [button, slug, filename] of [
    ['Select first', 'first', 'test-tone.mp3'],
    ['Select second', 'second', "bouche_d'incendie.mp3"],
    ['Select third', 'third', 'musique-étoile.mp3'],
  ]) {
    await page.getByRole('button', { name: button, exact: true }).click()
    await expect(page.locator('audio')).toHaveCount(1)
    const before = await page
      .locator('audio')
      .evaluate((a: HTMLAudioElement) => ({ src: a.src, paused: a.paused }))
    for (const link of [
      page.getByRole('link', { name: 'Download MP3' }),
      page.locator(`.row-download[href="/downloads/${slug}"]`),
    ]) {
      const count = downloads.length
      const pending = page.waitForEvent('download')
      await link.click()
      const download = await pending
      expect(download.suggestedFilename()).toBe(filename)
      expect(await download.failure()).toBeNull()
      expect(await readFile((await download.path())!)).toEqual(bytes)
      expect(downloads).toHaveLength(count + 1)
    }
    expect(
      await page
        .locator('audio')
        .evaluate((a: HTMLAudioElement) => ({ src: a.src, paused: a.paused })),
    ).toEqual(before)
    expect(page.url()).toBe(origin + '/player-test')
  }
})
