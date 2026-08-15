import { LOCAL_TERMINAL_PATH, type TerminalClientFrame, type TerminalServerFrame } from '../protocol.ts'

export interface LocalTerminalConnection {
  onReady?: (cwd: string, shell: string) => void
  onOutput?: (data: string) => void
  onExit?: (code: number | null, error?: string) => void
  send(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}

export function openTerminal(cwd: string | undefined, cols: number, rows: number): LocalTerminalConnection {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const query = new URLSearchParams({ cols: String(cols), rows: String(rows) })
  if (cwd !== undefined && cwd !== '') query.set('cwd', cwd)
  const socket = new WebSocket(`${scheme}://${window.location.host}${LOCAL_TERMINAL_PATH}?${query}`)
  let exited = false
  const connection: LocalTerminalConnection = {
    send: data => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data } satisfies TerminalClientFrame))
    },
    resize: (nextCols, nextRows) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols: nextCols, rows: nextRows } satisfies TerminalClientFrame))
    },
    close: () => {
      exited = true
      try { socket.close() } catch { /* already closed */ }
    },
  }
  socket.onmessage = (event: MessageEvent<string>) => {
    let frame: TerminalServerFrame
    try { frame = JSON.parse(event.data) as TerminalServerFrame } catch { return }
    if (frame.type === 'ready') connection.onReady?.(frame.cwd, frame.shell)
    if (frame.type === 'output') connection.onOutput?.(frame.data)
    if (frame.type === 'exit') {
      exited = true
      connection.onExit?.(frame.code, frame.error)
    }
  }
  socket.onerror = () => {
    if (!exited) connection.onExit?.(null, 'WebSocket connection failed')
    exited = true
  }
  socket.onclose = () => {
    if (!exited) connection.onExit?.(null, 'Terminal connection closed')
    exited = true
  }
  return connection
}
