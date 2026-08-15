import { describe, expect, it } from 'vitest'
import { clampTerminalSize, ensureSpawnHelperExecutable, resolveTerminalCwd } from '../src/pty-session.ts'

describe('local terminal PTY helpers', () => {
  it('clamps terminal dimensions', () => {
    expect(clampTerminalSize(0, 999)).toEqual({ cols: 2, rows: 200 })
    expect(clampTerminalSize(Number.NaN, Number.NaN)).toEqual({ cols: 80, rows: 24 })
  })

  it('falls back to the process directory for an invalid cwd', () => {
    expect(resolveTerminalCwd('/path/that/does/not/exist')).toBe(process.cwd())
  })

  it('makes the installed spawn helper executable', () => {
    expect(() => { ensureSpawnHelperExecutable() }).not.toThrow()
  })

})
