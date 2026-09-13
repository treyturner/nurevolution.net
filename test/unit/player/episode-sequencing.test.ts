import { expect, it, vi } from 'vitest'
import {
  createEpisodeSequencer,
  episodeNeighbor,
  type EpisodeMoveResult,
} from '../../../app/services/episode-sequencing'
import { playerEpisodes } from '../../fixtures/media-app/data/player'
const episodes = playerEpisodes('https://fixture.example')
function fixture() {
  let id = episodes[0]!.id
  let pending = false
  let finish!: (result: EpisodeMoveResult) => void
  const host = {
    neighbor: (direction: 'older' | 'newer') =>
      episodeNeighbor(episodes, id, direction),
    currentId: () => id,
    pending: () => pending,
    navigate: vi.fn(
      (_target: (typeof episodes)[number], _replace: boolean) =>
        new Promise<EpisodeMoveResult>((resolve) => {
          finish = resolve
        }),
    ),
    restart: vi.fn(),
    play: vi.fn(),
  }
  const changed = vi.fn()
  const sequence = createEpisodeSequencer(host, changed)
  return {
    sequence,
    host,
    changed,
    select: (next: string) => {
      id = next
    },
    pending: (value: boolean) => {
      pending = value
    },
    finish: (success: boolean) => finish(success ? 'committed' : 'failed'),
  }
}
it('uses supplied newest-first order and wraps both directions, including one/empty/missing selections', () => {
  for (let i = 0; i < episodes.length; i++) {
    expect(episodeNeighbor(episodes, episodes[i]!.id, 'older')).toBe(
      episodes[(i + 1) % 3],
    )
    expect(episodeNeighbor(episodes, episodes[i]!.id, 'newer')).toBe(
      episodes[(i + 2) % 3],
    )
  }
  expect(episodeNeighbor([episodes[0]!], episodes[0]!.id, 'older')).toBe(
    episodes[0],
  )
  expect(episodeNeighbor([], null, 'older')).toBeNull()
  expect(episodeNeighbor(episodes, 'missing', 'newer')).toBeNull()
})
it('replaces on automatic progression, fixes its target before order changes, and ignores repeated actions', async () => {
  const f = fixture()
  const completion = f.sequence.ended()
  expect(f.sequence.snapshot()).toMatchObject({
    busy: true,
    continuing: true,
    order: 'older',
  })
  expect(f.host.navigate).toHaveBeenCalledWith(episodes[1], true)
  f.sequence.setOrder('newer')
  await f.sequence.manual('newer')
  expect(f.host.navigate).toHaveBeenCalledOnce()
  f.select(episodes[1]!.id)
  f.finish(true)
  await completion
  expect(f.host.play).toHaveBeenCalledOnce()
  const next = f.sequence.ended()
  expect(f.host.navigate).toHaveBeenLastCalledWith(episodes[0], true)
  f.finish(false)
  await next
  expect(f.host.play).toHaveBeenCalledOnce()
  expect(f.sequence.snapshot().busy).toBe(false)
})
it('Pause cancels automatic continuation while a successful target still commits', async () => {
  const f = fixture()
  const completion = f.sequence.ended()
  f.sequence.pause()
  expect(f.sequence.snapshot().continuing).toBe(false)
  f.select(episodes[1]!.id)
  f.finish(true)
  await completion
  expect(f.host.play).not.toHaveBeenCalled()
})
it('manual navigation pushes; manual pending navigation, failures, superseded targets and disposal cannot autoplay', async () => {
  const f = fixture()
  f.pending(true)
  await f.sequence.ended()
  expect(f.host.navigate).not.toHaveBeenCalled()
  f.pending(false)
  const manual = f.sequence.manual('newer')
  expect(f.host.navigate).toHaveBeenCalledWith(episodes[2], false)
  f.finish(true)
  await manual
  expect(f.host.play).not.toHaveBeenCalled()
  const stale = f.sequence.ended()
  f.select(episodes[2]!.id)
  f.finish(true)
  await stale
  expect(f.host.play).not.toHaveBeenCalled()
  const disposed = f.sequence.ended()
  f.sequence.dispose()
  f.select(episodes[0]!.id)
  f.finish(true)
  await disposed
  await f.sequence.ended()
  expect(f.host.play).not.toHaveBeenCalled()
})
it('restarts one episode without routing and does nothing for a missing selection', async () => {
  const f = fixture()
  f.host.neighbor = () => episodes[0]!
  await f.sequence.manual('older')
  expect(f.host.restart).toHaveBeenCalledOnce()
  expect(f.host.play).not.toHaveBeenCalled()
  await f.sequence.ended()
  expect(f.host.restart).toHaveBeenCalledTimes(2)
  expect(f.host.play).toHaveBeenCalledOnce()
  expect(f.host.navigate).not.toHaveBeenCalled()
  f.host.neighbor = () => null
  expect(f.sequence.snapshot().available).toBe(false)
  await f.sequence.ended()
  expect(f.host.restart).toHaveBeenCalledTimes(2)
})
