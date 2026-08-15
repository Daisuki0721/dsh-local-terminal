import { LOCAL_TERMINAL_PATH, type TerminalClientFrame, type TerminalServerFrame } from '../protocol.ts'

export interface LocalTerminalConnection {
  onReady?: (cwd: string, shell: string, replayed: boolean) => void
  onOutput?: (data: string) => void
  onExit?: (code: number | null, error?: string) => void
  onState?: (state: 'connecting' | 'reconnecting' | 'open') => void
  send(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}

const MAX_PENDING_INPUT = 64 * 1024
const MAX_RECONNECT_DELAY = 5000

export function openTerminal(cwd: string | undefined, cols: number, rows: number, sessionId: string): LocalTerminalConnection {
  let socket: WebSocket | undefined
  let exited = false
  let closedByClient = false
  let attempt = 0
  let reconnecting = false
  let reconnectTimer: number | undefined
  let currentCols = cols
  let currentRows = rows
  const pendingInput: string[] = []
  let pendingLength = 0

  const connection: LocalTerminalConnection = {
    send: data => {
      if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data } satisfies TerminalClientFrame))
      } else if (!exited && !closedByClient && pendingLength < MAX_PENDING_INPUT) {
        pendingInput.push(data)
        pendingLength += data.length
      }
    },
    resize: (nextCols, nextRows) => {
      currentCols = nextCols
      currentRows = nextRows
      if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: nextCols, rows: nextRows } satisfies TerminalClientFrame))
      }
    },
    close: () => {
      closedByClient = true
      exited = true
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      try { socket?.send(JSON.stringify({ type: 'kill' } satisfies TerminalClientFrame)) } catch { /* already closed */ }
      try { socket?.close() } catch { /* already closed */ }
    },
  }

  const flushPendingInput = (): void => {
    if (pendingInput.length === 0) return
    const data = pendingInput.splice(0).join('')
    pendingLength = 0
    if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'input', data } satisfies TerminalClientFrame))
    }
  }

  const connect = (): void => {
    if (closedByClient || exited) return
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const query = new URLSearchParams({ cols: String(currentCols), rows: String(currentRows), session: sessionId })
    if (cwd !== undefined && cwd !== '') query.set('cwd', cwd)
    connection.onState?.(reconnecting ? 'reconnecting' : 'connecting')
    socket = new WebSocket(`${scheme}://${window.location.host}${LOCAL_TERMINAL_PATH}?${query}`)
    socket.onmessage = (event: MessageEvent<string>) => {
      let frame: TerminalServerFrame
      try { frame = JSON.parse(event.data) as TerminalServerFrame } catch { return }
      if (frame.type === 'ready') {
        reconnecting = false
        attempt = 0
        connection.onState?.('open')
        flushPendingInput()
        connection.onReady?.(frame.cwd, frame.shell, frame.replayed === true)
      }
      if (frame.type === 'output') connection.onOutput?.(frame.data)
      if (frame.type === 'exit') {
        exited = true
        if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
        connection.onExit?.(frame.code, frame.error)
      }
    }
    socket.onerror = () => { /* the close handler decides whether to reconnect */ }
    socket.onclose = () => {
      socket = undefined
      if (closedByClient || exited) return
      reconnecting = true
      const delay = Math.min(MAX_RECONNECT_DELAY, 400 * 2 ** attempt)
      attempt++
      connection.onState?.('reconnecting')
      reconnectTimer = window.setTimeout(connect, delay)
    }
  }

  connect()
  return connection
}
