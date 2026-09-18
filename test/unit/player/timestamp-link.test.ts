import { describe, expect, it } from 'vitest'
import {
  timestampIntent,
  timestampSeconds,
  timestampUrl,
  sameTimestamp,
} from '../../../app/services/timestamp-link'

const path = '/episodes/trey-turner-praxis'
describe('timestamp links', () => {
  it.each([
    'https://nurevolution.net',
    'https://3000--main--dev--treyturner.coder.treyturner.info',
    'http://localhost:3000',
  ])('preserves the supplied environment origin %s', (origin) => {
    expect(timestampUrl(origin, path + '?old=1#old', 208.794)).toBe(
      `${origin}${path}?t=208.794`,
    )
  })
  it('accepts only one bounded unsigned decimal and ignores non-episode URLs', () => {
    for (const value of [
      '0',
      '000',
      '208.794',
      '0001.250',
      String(Number.MAX_SAFE_INTEGER),
    ])
      expect(timestampIntent(path, { t: value })).toEqual({
        kind: 'time',
        seconds: Number(value),
      })
    for (const value of [
      null,
      undefined,
      '',
      ' ',
      '1 ',
      '-1',
      '+1',
      '1e2',
      '0x10',
      '1second',
      '.1',
      '1.',
      'Infinity',
      'NaN',
      '9'.repeat(64),
      '0'.repeat(65),
      ['1'],
      ['1', '2'],
      1,
    ])
      expect(timestampIntent(path, { t: value })).toEqual({ kind: 'invalid' })
    for (const ignored of ['/', '/?t=1', '/podcast/praxis', '/episodes/a/b'])
      expect(timestampIntent(ignored, { t: '1' })).toEqual({ kind: 'none' })
    expect(timestampIntent(path, {})).toEqual({ kind: 'none' })
    expect(timestampIntent(path, Object.create({ t: '1' }))).toEqual({
      kind: 'none',
    })
    expect(timestampIntent(path + '/', { t: '1' })).toEqual({
      kind: 'time',
      seconds: 1,
    })
  })
  it('round trips supported playhead and sample-derived fractions without rounding', () => {
    for (const seconds of [
      0,
      -0,
      0.0000001,
      1.23456789e-20,
      7695011 / 44100,
      3601.99999999,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const encoded = timestampSeconds(seconds)!
      expect(encoded).not.toMatch(/[e+]/)
      expect(timestampIntent(path, { t: encoded })).toEqual({
        kind: 'time',
        seconds: seconds === 0 ? 0 : seconds,
      })
      expect(
        timestampUrl(
          'https://nurevolution.net',
          path + '?other=1#old',
          seconds,
        ),
      ).toBe(`https://nurevolution.net${path}?t=${encoded}`)
    }
    for (const invalid of [
      Number.MIN_VALUE,
      -1,
      Infinity,
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(timestampSeconds(invalid)).toBeNull()
      expect(timestampUrl('https://nurevolution.net', path, invalid)).toBeNull()
    }
  })
  it('recognizes equivalent intent without reapplying unrelated query/hash navigation', () => {
    expect(sameTimestamp({ kind: 'none' }, { kind: 'none' })).toBe(true)
    expect(sameTimestamp({ kind: 'invalid' }, { kind: 'invalid' })).toBe(true)
    expect(sameTimestamp({ kind: 'none' }, { kind: 'invalid' })).toBe(false)
    expect(
      sameTimestamp({ kind: 'time', seconds: 1 }, { kind: 'time', seconds: 1 }),
    ).toBe(true)
    expect(
      sameTimestamp({ kind: 'time', seconds: 1 }, { kind: 'time', seconds: 2 }),
    ).toBe(false)
    expect(sameTimestamp({ kind: 'time', seconds: 1 }, { kind: 'none' })).toBe(
      false,
    )
  })
})
