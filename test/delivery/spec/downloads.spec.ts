import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('edge attachment redirect saves exact bytes and filenames while the shared player stays paused', async ({
  page,
}) => {
  const origin = process.env.DELIVERY_WEB_ORIGIN!
  const bytes = await readFile('test/fixtures/media-app/public/sample.mp3')
  await page.goto(origin + '/player-test')
  for (const [button, filename] of [
    ['Select first', 'test-tone.mp3'],
    ['Select second', "bouche_d'incendie.mp3"],
    ['Select third', 'musique-étoile.mp3'],
  ]) {
    await page.getByRole('button', { name: button, exact: true }).click()
    await expect(page.locator('audio')).toHaveCount(1)
    const before = await page
      .locator('audio')
      .evaluate((a: HTMLAudioElement) => ({ src: a.src, paused: a.paused }))
    const pending = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Download MP3' }).click()
    const download = await pending
    expect(download.suggestedFilename()).toBe(filename)
    expect(await download.failure()).toBeNull()
    expect(await readFile((await download.path())!)).toEqual(bytes)
    expect(
      await page
        .locator('audio')
        .evaluate((a: HTMLAudioElement) => ({ src: a.src, paused: a.paused })),
    ).toEqual(before)
    expect(page.url()).toBe(origin + '/player-test')
  }
})
