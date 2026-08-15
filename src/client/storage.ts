const STORAGE_KEY = 'dsh.localTerminal.v1'

export interface PersistedSession {
  id: number
  name: string
  cwd?: string
}

export interface PersistedTerminalState {
  open: boolean
  height?: string
  railWidth?: string
  activeId: number | null
  sessions: PersistedSession[]
}

const EMPTY: PersistedTerminalState = {
  open: false,
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
        && typeof session.name === 'string')
      : []
    return {
      open: parsed.open === true,
      height: typeof parsed.height === 'string' ? parsed.height : undefined,
      railWidth: typeof parsed.railWidth === 'string' ? parsed.railWidth : undefined,
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
