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
  railSide?: 'left' | 'right'
  railVisible?: boolean
  /** Sidebar units; each unit holds 1..6 pane member ids sharing one name. */
  groups?: number[][]
  splitRatio?: string
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
    const parsed = JSON.parse(raw) as Partial<PersistedTerminalState> & { split?: unknown }
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.filter((session): session is PersistedSession =>
        typeof session === 'object' && session !== null
        && typeof session.id === 'number' && Number.isFinite(session.id)
        && typeof session.name === 'string'
        && (session.sessionId === undefined || typeof session.sessionId === 'string'))
      : []
    const parseGroups = (): number[][] | undefined => {
      if (Array.isArray(parsed.groups)) {
        return parsed.groups.flatMap((raw): number[][] => {
          if (!Array.isArray(raw)) return []
          const members = raw.filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
          return members.length > 0 ? [members] : []
        })
      }
      // Migrate the legacy single split pair into a two-pane group.
      const rawSplit = parsed.split as { leftId?: unknown; rightId?: unknown } | undefined
      if (typeof rawSplit === 'object' && rawSplit !== null
        && typeof rawSplit.leftId === 'number' && Number.isFinite(rawSplit.leftId)
        && typeof rawSplit.rightId === 'number' && Number.isFinite(rawSplit.rightId)) {
        return [[rawSplit.leftId, rawSplit.rightId]]
      }
      return undefined
    }
    return {
      open: parsed.open === true,
      height: typeof parsed.height === 'string' ? parsed.height : undefined,
      railWidth: typeof parsed.railWidth === 'string' ? parsed.railWidth : undefined,
      railSide: parsed.railSide === 'left' ? 'left' : 'right',
      railVisible: parsed.railVisible !== false,
      groups: parseGroups(),
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
