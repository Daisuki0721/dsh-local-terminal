import { describe, expect, it } from 'vitest'
import { clampTerminalSize, ensureSpawnHelperExecutable, openLocalPty, resolveTerminalCwd } from '../src/pty-session.ts'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Some sandboxes (e.g. DSH command sandbox) forbid posix_spawnp; skip PTY tests there. */
const canSpawnPty = ((): boolean => {
  try {
    openLocalPty({ cols: 80, rows: 24 }).close()
    return true
  } catch {
    return false
  }
})()

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

describe.skipIf(!canSpawnPty)('local terminal PTY detach/replay', () => {
  it('replays output produced while no listener was attached', async () => {
    const session = openLocalPty({ cols: 80, rows: 24 })
    try {
      await sleep(800)
      const drained: string[] = []
      const subscription = session.onData(data => { drained.push(data) })
      await sleep(300)
      subscription.dispose()
      session.write('echo DETACHED_MARKER_42\r')
      await sleep(700)
      const replayed: string[] = []
      session.onData(data => { replayed.push(data) })
      expect(replayed.join('')).toContain('DETACHED_MARKER_42')
    } finally {
      session.close()
    }
  }, 15000)

  it('records the exit state and replays it to late listeners', async () => {
    const session = openLocalPty({ cols: 80, rows: 24 })
    try {
      await sleep(800)
      session.write('exit\r')
      const event = await new Promise<{ exitCode: number; signal?: number }>((resolve, reject) => {
        session.onExit(resolve)
        setTimeout(() => { reject(new Error('shell did not exit in time')) }, 8000)
      })
      expect(typeof event.exitCode).toBe('number')
      expect(session.exitState?.exitCode).toBe(event.exitCode)
      const late = await new Promise<{ exitCode: number; signal?: number }>(resolve => {
        session.onExit(resolve)
      })
      expect(late.exitCode).toBe(event.exitCode)
    } finally {
      session.close()
    }
  }, 15000)
})
