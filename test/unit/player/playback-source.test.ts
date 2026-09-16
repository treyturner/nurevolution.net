import { expect, it, vi } from 'vitest'
import { playerSource } from '../../../app/services/playback-source'
import type { EpisodeDetail } from '../../../shared/content/public'

it('uses virtual playback only for qualified Chromium and a supported codec', () => {
  const episode = {
    id: 'test',
    audio: {
      url: 'https://podcast.nurevolution.net/a.mp3',
      playback: {
        url: 'https://media.example/virtual.m4a',
        mediaType: 'audio/mp4',
        codecs: 'mp4a.6B',
      },
    },
  } as EpisodeDetail
  const canPlay = vi.fn(() => 'probably')
  for (const ua of [
    'Mozilla Chrome/153.0.0.0 Safari/537.36',
    'Android Chromium/153.0 EdgA/153',
  ]) {
    expect(playerSource(episode, 'https://dev.example', ua, canPlay)).toEqual({
      id: 'test',
      url: episode.audio.playback!.url,
      fallbackUrl: 'https://dev.example/a.mp3',
    })
  }
  expect(canPlay).toHaveBeenCalledWith('audio/mp4; codecs="mp4a.6B"')
  expect(
    playerSource(
      {
        ...episode,
        audio: {
          ...episode.audio,
          playback: {
            ...episode.audio.playback!,
            url: '/playback/preview.m4a',
          },
        },
      },
      '',
      'Chrome/153',
      canPlay,
      'https://preview.example/episodes/test',
    ).url,
  ).toBe('https://preview.example/playback/preview.m4a')
  for (const ua of [
    'Firefox/155',
    'Version/26 Safari/605',
    'iPhone CriOS/153',
    'iPad Chrome/153',
    'iPod Chrome/153',
    'Chrome/153 EdgiOS/1',
    'Chrome/153 OPiOS/1',
    '',
  ]) {
    expect(playerSource(episode, '', ua, canPlay)).toEqual({
      id: 'test',
      url: episode.audio.url,
    })
  }
  expect(playerSource(episode, '', 'Chrome/153', () => '')).toEqual({
    id: 'test',
    url: episode.audio.url,
  })
  expect(
    playerSource(
      { ...episode, audio: { ...episode.audio, playback: undefined } },
      '',
      'Chrome/153',
      canPlay,
    ),
  ).toEqual({ id: 'test', url: episode.audio.url })
})
