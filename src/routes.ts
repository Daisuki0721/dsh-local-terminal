import type { IncomingMessage } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { openLocalPty, type LocalPtySession } from './pty-session.ts'
import { LOCAL_TERMINAL_PATH, type TerminalClientFrame, type TerminalServerFrame } from './protocol.ts'

const wss = new WebSocketServer({ noServer: true })
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024
/** Keep a detached PTY alive this long so the client can reconnect to it. */
const DETACH_GRACE_MS = 60_000
const MAX_SESSION_ID_LENGTH = 64

interface AttachedPty {
  session: LocalPtySession
  ws?: WebSocket
  notify?: (frame: TerminalServerFrame) => void
  timer?: ReturnType<typeof setTimeout>
}

export function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try { hostUrl = new URL(`http://${host}`) } catch { return false }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}

export function makeTerminalUpgrade(): { upgrade: WebUpgradeRoute; dispose: () => void } {
  const sessions = new Map<string, AttachedPty>()

  const dispose = (): void => {
    for (const attached of sessions.values()) {
      if (attached.timer !== undefined) clearTimeout(attached.timer)
      attached.session.close()
    }
    sessions.clear()
  }

  const scheduleDetachCleanup = (sessionId: string, entry: AttachedPty): void => {
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.session.close()
      sessions.delete(sessionId)
    }, DETACH_GRACE_MS)
  }

  const upgrade: WebUpgradeRoute = {
    path: LOCAL_TERMINAL_PATH,
    handler: (request, socket, head) => {
      if (!isLoopbackRequest(request)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const sessionId = url.searchParams.get('session')
      if (sessionId === null || sessionId === '' || sessionId.length > MAX_SESSION_ID_LENGTH) {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      const cols = Number.parseInt(url.searchParams.get('cols') ?? '80', 10)
      const rows = Number.parseInt(url.searchParams.get('rows') ?? '24', 10)
      const cwd = url.searchParams.get('cwd') ?? undefined
      wss.handleUpgrade(request, socket, head, (ws) => {
        let session: LocalPtySession | undefined
        let settled = false
        const send = (frame: TerminalServerFrame): void => {
          if (settled || ws.readyState !== WebSocket.OPEN) return
          if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
            settled = true
            try { ws.close(1013, 'terminal output backpressure') } catch { /* already closed */ }
            sessions.delete(sessionId)
            session?.close()
            return
          }
          ws.send(JSON.stringify(frame))
        }
        const finish = (): void => {
          if (settled) return
          settled = true
          session = undefined
        }
        const attachTo = (entry: AttachedPty, replayed: boolean): void => {
          session = entry.session
          entry.ws = ws
          entry.notify = send
          if (entry.timer !== undefined) {
            clearTimeout(entry.timer)
            entry.timer = undefined
          }
          send({ type: 'ready', cwd: session.cwd, shell: session.shell, ...(replayed ? { replayed: true } : {}) })
          session.onData(data => send({ type: 'output', data }))
          if (session.exitState !== null) {
            send({ type: 'exit', code: session.exitState.exitCode, signal: session.exitState.signal })
            try { ws.close(1000) } catch { /* already closed */ }
            finish()
            sessions.delete(sessionId)
            return
          }
          ws.on('message', data => {
            let frame: TerminalClientFrame
            try { frame = JSON.parse(String(data)) as TerminalClientFrame } catch { return }
            if (frame.type === 'input' && typeof frame.data === 'string') session?.write(frame.data)
            if (frame.type === 'resize') session?.resize(frame.cols, frame.rows)
            if (frame.type === 'kill') {
              entry.ws = undefined
              entry.notify = undefined
              sessions.delete(sessionId)
              session?.close()
              finish()
              try { ws.close(1000) } catch { /* already closed */ }
            }
          })
        }
        const detach = (): void => {
          if (settled) return
          settled = true
          const entry = sessions.get(sessionId)
          if (entry !== undefined && entry.ws === ws) {
            entry.ws = undefined
            entry.notify = undefined
            scheduleDetachCleanup(sessionId, entry)
          }
          session = undefined
        }
        const existing = sessions.get(sessionId)
        if (existing !== undefined) {
          attachTo(existing, true)
        } else {
          try {
            const created = openLocalPty({ cwd, cols, rows })
            const entry: AttachedPty = { session: created }
            sessions.set(sessionId, entry)
            created.onExit(event => {
              const ws = entry.ws
              entry.notify?.({ type: 'exit', code: event.exitCode, signal: event.signal })
              entry.notify = undefined
              entry.ws = undefined
              try { ws?.close(1000) } catch { /* already closed */ }
              if (entry.timer === undefined) scheduleDetachCleanup(sessionId, entry)
            })
            attachTo(entry, false)
          } catch (error) {
            send({ type: 'exit', code: null, error: error instanceof Error ? error.message : String(error) })
            try { ws.close(1011) } catch { /* already closed */ }
            finish()
            return
          }
        }
        ws.on('close', detach)
        ws.on('error', detach)
      })
    },
  }

  return { upgrade, dispose }
}
