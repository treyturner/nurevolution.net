import { expect, it } from 'vitest'
import { deliveryAssetUrl } from '../../../app/services/delivery-assets'

it('uses delivery hosts while preserving exact asset paths, escaping and canonical inputs', () => {
  const artwork =
    'https://nurevolution.net/wp/wp-content/uploads/cover%20art.png'
  const audio =
    'https://podcast.nurevolution.net/artist%20-%20title.mp3?x=1#t=20'
  expect(
    deliveryAssetUrl(artwork, 'artwork', 'https://dev.nurevolution.net'),
  ).toBe('https://dev.nurevolution.net/wp/wp-content/uploads/cover%20art.png')
  expect(
    deliveryAssetUrl(audio, 'audio', 'https://podcast-dev.nurevolution.net'),
  ).toBe('https://podcast-dev.nurevolution.net/artist%20-%20title.mp3?x=1#t=20')
  expect(deliveryAssetUrl(audio, 'audio', '')).toBe(audio)
  expect(
    deliveryAssetUrl(audio, 'audio', 'https://podcast.nurevolution.net'),
  ).toBe(audio)
  for (const url of [
    '/sample.mp3',
    'https://elsewhere.example/a.mp3',
    'https://podcast.nurevolution.net.evil.example/a.mp3',
    'https://podcast.nurevolution.net@evil.example/a.mp3',
  ])
    expect(deliveryAssetUrl(url, 'audio', 'https://dev.example')).toBe(url)
})
