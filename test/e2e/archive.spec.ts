import { expect, test } from '@playwright/test'
import type { EpisodeDetail, EpisodeSummary } from '../../shared/content/public'
import legacy from '../../content/legacy-urls.json' with { type: 'json' }
import { hydrated, stubArchiveMedia } from './media'

test('every canonical page renders its exact archive content and all historical links reach it', async ({
  request,
  page,
}) => {
  await stubArchiveMedia(page)
  const { episodes } = (await (await request.get('/api/episodes')).json()) as {
    episodes: EpisodeSummary[]
  }
  expect(episodes).toHaveLength(55)
  let tracks = 0
  for (const summary of episodes) {
    const detail = (await (
      await request.get(`/api/episodes/${summary.slug}`)
    ).json()) as EpisodeDetail
    const response = await request.get(summary.path)
    expect(response.status(), summary.path).toBe(200)
    const html = await response.text()
    const rendered = await page.evaluate((source) => {
      const doc = new DOMParser().parseFromString(source, 'text/html')
      return {
        title: doc.querySelector('h1')?.textContent,
        canonical: doc
          .querySelector('link[rel="canonical"]')
          ?.getAttribute('href'),
        feed: doc
          .querySelector('link[type="application/rss+xml"]')
          ?.getAttribute('href'),
        artwork: doc.querySelector('.artwork img')?.getAttribute('src'),
        downloads: Array.from(
          doc.querySelectorAll<HTMLAnchorElement>('a[download]'),
        ).map((a) => a.getAttribute('href')),
        episodes: Array.from(
          doc.querySelectorAll('.episode-list li > a:first-child'),
        ).map((a) => a.getAttribute('href')),
        tracks: Array.from(doc.querySelectorAll('.track-list li')).map(
          (li) => ({
            artist: li.querySelector('.track-artist')?.textContent,
            title: li.querySelector('.track-title')?.textContent,
          }),
        ),
        audio: doc.querySelectorAll('audio').length,
      }
    }, html)
    expect(rendered).toMatchObject({
      title: detail.title,
      canonical: `https://nurevolution.net${detail.path}`,
      feed: '/feed/podcast',
      artwork: detail.artworkUrl,
      audio: 1,
    })
    expect(rendered.episodes).toEqual(episodes.map((e) => e.path))
    expect(rendered.downloads).toEqual([
      `/downloads/${detail.slug}`,
      ...episodes.map((e) => `/downloads/${e.slug}`),
    ])
    expect(rendered.tracks).toEqual(
      detail.tracks.map((t) => ({ artist: t.artist, title: t.title })),
    )
    tracks += rendered.tracks.length
    const historical = legacy.entries.find(
      (entry) => entry.episodeId === detail.id,
    )!
    const oldPath = new URL(historical.url).pathname
    for (const suffix of ['', '/?from=legacy']) {
      const moved = await request.get(`${oldPath}${suffix}`, {
        maxRedirects: 0,
      })
      expect(moved.status()).toBe(301)
      expect(moved.headers().location).toBe(detail.path)
    }
  }
  expect(tracks).toBe(832)
  for (const path of ['/episodes/unknown', '/podcast/unknown'])
    expect((await request.get(path)).status()).toBe(404)
})

test('encoded URL delimiters in episode slugs return a real 404', async ({
  request,
}) => {
  for (const slug of [
    '%23foo',
    '%3Ffoo',
    'trey-turner-praxis%23foo',
    'trey-turner-praxis%3Ffoo',
  ]) {
    const response = await request.get(`/episodes/${slug}`)
    expect.soft(response.status(), slug).toBe(404)
    expect.soft(await response.text(), slug).toContain('Episode not found')
  }
})

test('trailing-slash episode URLs retain the saved canonical through hydration and history', async ({
  request,
  page,
}) => {
  const path = '/episodes/trey-turner-praxis'
  const alternate = `${path}/?from=bookmark`
  const canonical = `https://nurevolution.net${path}`
  const response = await request.get(alternate)
  expect(response.status()).toBe(200)
  expect(await response.text()).toContain(
    `<link rel="canonical" href="${canonical}">`,
  )
  await stubArchiveMedia(page)
  await page.goto(alternate)
  await hydrated(page)
  await expect(page.locator('h1')).toHaveText('Praxis')
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    canonical,
  )
  await page.locator('a[href="/episodes/trey-turner-ruminate"]').click()
  await expect(page.locator('h1')).toHaveText('Ruminate')
  await page.goBack()
  await expect(page.locator('h1')).toHaveText('Praxis')
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    canonical,
  )
})

test('mobile tabs keep both lists accessible, retain focus, and reflow with large text', async ({
  page,
}) => {
  await stubArchiveMedia(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/episodes/trey-turner-praxis')
  await hydrated(page)
  const episodes = page.getByRole('tab', { name: 'Episodes', exact: true }),
    tracks = page.getByRole('tab', { name: 'Tracklist', exact: true })
  await episodes.focus()
  await page.keyboard.press('ArrowRight')
  await expect(tracks).toBeFocused()
  await expect(tracks).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.track-list li')).toHaveCount(21)
  await expect(page.locator('#episodes-panel')).toBeHidden()
  await page.keyboard.press('Home')
  await expect(episodes).toBeFocused()
  const link = page.locator(
    '.episode-list a[href="/episodes/trey-turner-ruminate"]',
  )
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('h1')).toHaveText('Ruminate')
  await expect(link).toBeFocused()
  await expect(page.locator('#episode-selection-status')).toHaveText(
    'Selected Trey Turner — Ruminate',
  )
  await page.setViewportSize({ width: 320, height: 740 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  const text = page.locator('.episode-list-info').first()
  const textWidth = (await text.boundingBox())!.width
  const titleFontSize = await text
    .locator('.episode-list-title')
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
  expect(textWidth).toBeGreaterThanOrEqual(titleFontSize * 2)
  await tracks.click()
  await expect(page.locator('#tracks-panel')).toBeVisible()
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(page.getByRole('tablist')).toHaveCount(0)
  await expect(page.locator('#episodes-panel')).toBeVisible()
  await expect(page.locator('#tracks-panel')).toBeVisible()
})
