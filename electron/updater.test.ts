import { describe, expect, it } from 'vitest'
import { compareVersions } from './updater'

describe('compareVersions', () => {
  it('compares common release versions', () => {
    expect(compareVersions('1.1.0', '1.0.9')).toBe(1)
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0)
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
  })

  it('handles missing segments', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })
})
