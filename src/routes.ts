import type { IncomingMessage } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { openLocalPty, type LocalPtySession } from './pty-session.ts'
import { LOCAL_TERMINAL_PATH, type TerminalClientFrame, type TerminalServerFrame } from './protocol.ts'

const wss = new WebSocketServer({ noServer: true })
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024

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

export function makeTerminalUpgrade(onSession?: (session: LocalPtySession) => () => void): WebUpgradeRoute {
  return {
    path: LOCAL_TERMINAL_PATH,
    handler: (request, socket, head) => {
      if (!isLoopbackRequest(request)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const cols = Number.parseInt(url.searchParams.get('cols') ?? '80', 10)
      const rows = Number.parseInt(url.searchParams.get('rows') ?? '24', 10)
      const cwd = url.searchParams.get('cwd') ?? undefined
      wss.handleUpgrade(request, socket, head, (ws) => {
        let session: LocalPtySession | undefined
        let removeSession: (() => void) | undefined
        let settled = false
        const send = (frame: TerminalServerFrame): void => {
          if (settled || ws.readyState !== WebSocket.OPEN) return
          if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
            settled = true
            try { ws.close(1013, 'terminal output backpressure') } catch { /* already closed */ }
            session?.close()
            return
          }
          ws.send(JSON.stringify(frame))
        }
        const close = (): void => {
          if (settled) return
          settled = true
          removeSession?.()
          removeSession = undefined
          session?.close()
          session = undefined
        }
        try {
          session = openLocalPty({ cwd, cols, rows })
          removeSession = onSession?.(session)
          send({ type: 'ready', cwd: session.cwd, shell: session.shell })
          session.onData(data => send({ type: 'output', data }))
          session.onExit(event => {
            send({ type: 'exit', code: event.exitCode, signal: event.signal })
            try { ws.close(1000) } catch { /* already closed */ }
            close()
          })
        } catch (error) {
          send({ type: 'exit', code: null, error: error instanceof Error ? error.message : String(error) })
          try { ws.close(1011) } catch { /* already closed */ }
          close()
          return
        }
        ws.on('message', data => {
          let frame: TerminalClientFrame
          try { frame = JSON.parse(String(data)) as TerminalClientFrame } catch { return }
          if (frame.type === 'input' && typeof frame.data === 'string') session?.write(frame.data)
          if (frame.type === 'resize') session?.resize(frame.cols, frame.rows)
        })
        ws.on('close', close)
        ws.on('error', close)
      })
    },
  }
}
