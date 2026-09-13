import { describe, expect, it, vi } from 'vitest'
import { createPlayerVolume } from '../../../app/services/player-volume'
function setup(paused = true) {
  const state = { volume: 1, muted: false, paused }
  const audio = {
    snapshot: () => ({ ...state }),
    setVolume: vi.fn((value: number) => {
      state.volume = value
    }),
    setMuted: vi.fn((value: boolean) => {
      state.muted = value
    }),
  }
  return { audio, state }
}
describe('element volume capabilities', () => {
  it('probes while paused, restores the initial values, and never probes active sound', () => {
    const { audio, state } = setup()
    state.volume = 0.5
    state.muted = true
    const volume = createPlayerVolume(audio)
    expect(volume.snapshot()).toEqual({
      volume: 0.5,
      muted: true,
      volumeSupported: true,
      muteSupported: true,
    })
    expect(audio.setVolume).toHaveBeenCalledWith(0.25)
    const active = setup(false)
    expect(createPlayerVolume(active.audio).snapshot().volumeSupported).toBe(
      false,
    )
    expect(active.audio.setVolume).not.toHaveBeenCalled()
    expect(active.audio.setMuted).not.toHaveBeenCalled()
  })
  it('contains ignored writes and exceptions without conflating volume and mute', () => {
    const { audio } = setup()
    audio.setVolume.mockImplementation(() => {})
    const volume = createPlayerVolume(audio)
    expect(volume.snapshot()).toMatchObject({
      volumeSupported: false,
      muteSupported: true,
    })
    volume.toggleMute()
    expect(volume.snapshot().muted).toBe(true)
    const denied = setup()
    denied.audio.setVolume.mockImplementation(() => {
      throw new Error('hardware')
    })
    denied.audio.setMuted.mockImplementation(() => {
      throw new Error('hardware')
    })
    const unsupported = createPlayerVolume(denied.audio)
    unsupported.toggleMute()
    unsupported.setVolume(0.3)
    expect(unsupported.snapshot()).toMatchObject({
      volumeSupported: false,
      muteSupported: false,
    })
  })
  it('clamps volume, unmutes a positive change, and restores the last nonzero volume from zero', () => {
    const { audio, state } = setup()
    const volume = createPlayerVolume(audio)
    volume.setVolume(0.35)
    volume.toggleMute()
    expect(state.muted).toBe(true)
    volume.setVolume(0.5)
    expect(state.muted).toBe(false)
    volume.setVolume(0)
    volume.toggleMute()
    expect(state.volume).toBe(0.5)
    expect(state.muted).toBe(false)
    volume.setVolume(2)
    expect(state.volume).toBe(1)
    volume.setVolume(-1)
    expect(state.volume).toBe(0)
    volume.setVolume(NaN)
    expect(state.volume).toBe(0)
  })
  it('reflects external changes and downgrades capabilities when later assignments fail', () => {
    const { audio, state } = setup()
    const volume = createPlayerVolume(audio)
    state.volume = 0.65
    expect(volume.snapshot().volume).toBe(0.65)
    state.volume = 0
    volume.toggleMute()
    expect(state.volume).toBe(0.65)
    audio.setVolume.mockImplementation(() => {})
    volume.setVolume(0.2)
    expect(volume.snapshot().volumeSupported).toBe(false)
    audio.setMuted.mockImplementation(() => {
      throw new Error('denied')
    })
    volume.toggleMute()
    expect(volume.snapshot().muteSupported).toBe(false)
  })
  it('contains later volume exceptions and ignored mute, including failed probe restoration', () => {
    const { audio } = setup()
    const volume = createPlayerVolume(audio)
    audio.setVolume.mockImplementation(() => {
      throw new Error('denied')
    })
    volume.setVolume(0.2)
    audio.setMuted.mockImplementation(() => {})
    volume.toggleMute()
    expect(volume.snapshot()).toMatchObject({
      volumeSupported: false,
      muteSupported: false,
    })
    const restoration = setup()
    restoration.audio.setVolume
      .mockImplementationOnce((v) => {
        restoration.state.volume = v
      })
      .mockImplementationOnce(() => {})
    restoration.audio.setMuted
      .mockImplementationOnce((v) => {
        restoration.state.muted = v
      })
      .mockImplementationOnce(() => {})
    expect(createPlayerVolume(restoration.audio).snapshot()).toMatchObject({
      volumeSupported: false,
      muteSupported: false,
    })
  })
})
