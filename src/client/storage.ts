const STORAGE_KEY = 'dsh.localTerminal.v1'

export interface PersistedSession {
  id: number
  sessionId?: string
  name: string
  cwd?: string
}

export interface PersistedTerminalState {
  open: boolean
  height?: string
  railWidth?: string
  split?: { leftId: number; rightId: number } | null
  splitRatio?: string
  activeId: number | null
  sessions: PersistedSession[]
}

const EMPTY: PersistedTerminalState = {
  open: false,
  split: null,
  activeId: null,
  sessions: [],
}

export function loadTerminalState(): PersistedTerminalState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return EMPTY
    const parsed = JSON.parse(raw) as Partial<PersistedTerminalState>
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.filter((session): session is PersistedSession =>
        typeof session === 'object' && session !== null
        && typeof session.id === 'number' && Number.isFinite(session.id)
        && typeof session.name === 'string'
        && (session.sessionId === undefined || typeof session.sessionId === 'string'))
      : []
    const rawSplit = parsed.split
    const split = typeof rawSplit === 'object' && rawSplit !== null
      && typeof rawSplit.leftId === 'number' && Number.isFinite(rawSplit.leftId)
      && typeof rawSplit.rightId === 'number' && Number.isFinite(rawSplit.rightId)
      ? { leftId: rawSplit.leftId, rightId: rawSplit.rightId }
      : null
    return {
      open: parsed.open === true,
      height: typeof parsed.height === 'string' ? parsed.height : undefined,
      railWidth: typeof parsed.railWidth === 'string' ? parsed.railWidth : undefined,
      split,
      splitRatio: typeof parsed.splitRatio === 'string' ? parsed.splitRatio : undefined,
      activeId: typeof parsed.activeId === 'number' ? parsed.activeId : null,
      sessions,
    }
  } catch {
    return EMPTY
  }
}

export function saveTerminalState(state: PersistedTerminalState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage full or unavailable: persistence is best-effort.
  }
}
