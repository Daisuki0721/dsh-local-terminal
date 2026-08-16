import { chmodSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import * as pty from 'node-pty'

const require = createRequire(import.meta.url)

export interface LocalPtySession {
  readonly cwd: string
  readonly shell: string
  readonly exitState: { exitCode: number; signal?: number } | null
  write(data: string): void
  resize(cols: number, rows: number): void
  close(): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

export function clampTerminalSize(cols: number, rows: number): { cols: number; rows: number } {
  return {
    cols: Number.isFinite(cols) ? Math.min(500, Math.max(2, Math.trunc(cols))) : 80,
    rows: Number.isFinite(rows) ? Math.min(200, Math.max(1, Math.trunc(rows))) : 24,
  }
}

export function resolveTerminalCwd(candidate?: string): string {
  if (candidate !== undefined && candidate !== '') {
    const path = isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate)
    try {
      if (existsSync(path) && statSync(path).isDirectory()) return path
    } catch {
      // Fall through to the process directory.
    }
  }
  return process.cwd()
}

/**
 * node-pty 1.1.0's macOS prebuild can arrive without the executable bit on
 * spawn-helper when restored through a content-addressed package store.
 * Repair only that package-owned helper before the native fork call.
 */
export function ensureSpawnHelperExecutable(): void {
  if (process.platform === 'win32') return
  const packageRoot = dirname(require.resolve('node-pty/package.json'))
  const candidates = [
    join(packageRoot, 'build', 'Release', 'spawn-helper'),
    join(packageRoot, 'build', 'Debug', 'spawn-helper'),
    join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const mode = statSync(candidate).mode & 0o777
    if ((mode & 0o111) === 0) chmodSync(candidate, mode | 0o755)
    return
  }
}

export interface ResolvedShell {
  shell: string
  args: string[]
}

/**
 * Locate an executable on PATH. On Windows the candidate name is tried with
 * each PATHEXT extension so `findExecutable('pwsh')` resolves `pwsh.EXE`; on
 * POSIX the name is used verbatim.
 */
function findExecutable(name: string): string | undefined {
  if (isAbsolute(name) && existsSync(name)) return name
  const pathEnv = process.env.PATH ?? ''
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : ['']
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === '') continue
    for (const ext of extensions) {
      const candidate = join(dir, name + ext)
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return undefined
}

function resolveWindowsShell(): ResolvedShell {
  const pwsh = findExecutable('pwsh')
  if (pwsh !== undefined) return { shell: pwsh, args: ['-NoLogo'] }
  const powershell = findExecutable('powershell')
  if (powershell !== undefined) return { shell: powershell, args: ['-NoLogo'] }
  const comSpec = process.env.ComSpec
  if (comSpec !== undefined && comSpec !== '') return { shell: comSpec, args: [] }
  const cmd = findExecutable('cmd')
  if (cmd !== undefined) return { shell: cmd, args: [] }
  throw new Error('No usable Windows shell found (tried pwsh, powershell, and cmd).')
}

function resolvePosixShell(): ResolvedShell {
  const configured = process.env.SHELL
  if (configured !== undefined && configured !== '' && existsSync(configured)) {
    return { shell: configured, args: ['-l'] }
  }
  for (const candidate of ['/bin/zsh', '/usr/bin/zsh', '/bin/bash', '/usr/bin/bash', '/bin/sh']) {
    if (existsSync(candidate)) return { shell: candidate, args: ['-l'] }
  }
  throw new Error('No usable POSIX shell found (tried $SHELL, /bin/zsh, /bin/bash, and /bin/sh).')
}

export function resolveShell(): ResolvedShell {
  return process.platform === 'win32' ? resolveWindowsShell() : resolvePosixShell()
}

export function openLocalPty(options: { cwd?: string; cols: number; rows: number }): LocalPtySession {
  ensureSpawnHelperExecutable()
  const { shell, args } = resolveShell()
  const cwd = resolveTerminalCwd(options.cwd)
  const size = clampTerminalSize(options.cols, options.rows)
  const child = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: size.cols,
    rows: size.rows,
    cwd,
    env: {
      ...process.env,
      HOME: process.env.HOME ?? homedir(),
      SHELL: shell,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  })
  let closed = false
  let exitState: { exitCode: number; signal?: number } | null = null
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()
  const pendingData: string[] = []
  let pendingLength = 0
  const dataSubscription = child.onData(data => {
    if (dataListeners.size !== 0) {
      for (const listener of dataListeners) listener(data)
      return
    }
    // zsh (especially Powerlevel10k instant prompt) can write before the
    // websocket route has installed its listener, and a detached session
    // keeps producing output while the client reconnects. Keep that output
    // in a bounded buffer so it can be replayed on (re)attach.
    if (pendingLength < 1024 * 1024) {
      pendingData.push(data)
      pendingLength += data.length
    }
  })
  child.onExit(event => {
    exitState = { exitCode: event.exitCode, ...(event.signal !== undefined ? { signal: event.signal } : {}) }
    for (const listener of exitListeners) listener(event)
  })
  return {
    cwd,
    shell,
    get exitState() { return exitState },
    write: data => { if (!closed) child.write(data) },
    resize: (cols, rows) => {
      if (closed) return
      const next = clampTerminalSize(cols, rows)
      child.resize(next.cols, next.rows)
    },
    close: () => {
      if (closed) return
      closed = true
      dataSubscription.dispose()
      dataListeners.clear()
      exitListeners.clear()
      pendingData.length = 0
      try { child.kill() } catch { /* already exited */ }
    },
    onData: listener => {
      dataListeners.add(listener)
      if (pendingData.length !== 0) {
        const buffered = pendingData.splice(0).join('')
        pendingLength = 0
        listener(buffered)
      }
      return { dispose: () => { dataListeners.delete(listener) } }
    },
    onExit: listener => {
      exitListeners.add(listener)
      if (exitState !== null) listener(exitState)
      return { dispose: () => { exitListeners.delete(listener) } }
    },
  }
}
