interface VolumePort {
  snapshot(): { volume: number; muted: boolean; paused: boolean }
  setVolume(value: number): void
  setMuted(value: boolean): void
}

/** Element volume and mute are independent capabilities; neither is device volume. */
export function createPlayerVolume(audio: VolumePort) {
  let volumeSupported = false
  let muteSupported = false
  let lastNonzero = 1
  const initial = audio.snapshot()
  if (initial.paused) {
    const probe = initial.volume === 0.5 ? 0.25 : 0.5
    try {
      audio.setVolume(probe)
      volumeSupported = audio.snapshot().volume === probe
    } catch {
      /* Hardware-owned volume can reject assignments. */
    } finally {
      try {
        audio.setVolume(initial.volume)
        if (audio.snapshot().volume !== initial.volume) volumeSupported = false
      } catch {
        volumeSupported = false
      }
    }
    try {
      audio.setMuted(!initial.muted)
      muteSupported = audio.snapshot().muted === !initial.muted
    } catch {
      /* Mute may still work when volume does not, or vice versa. */
    } finally {
      try {
        audio.setMuted(initial.muted)
        if (audio.snapshot().muted !== initial.muted) muteSupported = false
      } catch {
        muteSupported = false
      }
    }
  }
  function observe() {
    const actual = audio.snapshot()
    if (actual.volume > 0) lastNonzero = actual.volume
    return {
      volume: actual.volume,
      muted: actual.muted,
      volumeSupported,
      muteSupported,
    }
  }
  function setMuted(value: boolean) {
    if (!muteSupported) return
    try {
      audio.setMuted(value)
      muteSupported = audio.snapshot().muted === value
    } catch {
      muteSupported = false
    }
  }
  return {
    snapshot: observe,
    setVolume(value: number) {
      if (!volumeSupported || !Number.isFinite(value)) return
      const target = Math.min(1, Math.max(0, value))
      try {
        audio.setVolume(target)
        volumeSupported = Math.abs(audio.snapshot().volume - target) < 0.001
        if (volumeSupported && target > 0) setMuted(false)
      } catch {
        volumeSupported = false
      }
      observe()
    },
    toggleMute() {
      const actual = observe()
      if (!muteSupported) return
      const unmute = actual.muted || actual.volume === 0
      if (unmute && actual.volume === 0 && volumeSupported)
        this.setVolume(lastNonzero)
      setMuted(!unmute)
    },
  }
}
