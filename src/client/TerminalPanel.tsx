import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { openTerminal, type LocalTerminalConnection } from './api.ts'
import type { TerminalController } from './controller.ts'
import { loadTerminalState, saveTerminalState, type PersistedSession } from './storage.ts'
import { TerminalIcon } from './TerminalButton.tsx'
import { XTERM_CSS } from './xterm-css.ts'
import css from './terminal.module.css'

interface TerminalSessionModel {
  id: number
  sessionId: string
  name: string
  cwd?: string
  restart: number
}

function newSessionId(): string {
  return `zsh-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

interface TerminalActions {
  clear(): void
  focus(): void
  findNext(query: string): boolean
  findPrevious(query: string): boolean
  copy(): void
  copyAsHtml(): void
  paste(): void
  selectAll(): void
  hasSelection(): boolean
}

interface TerminalContextMenu {
  id: number
  kind: 'session' | 'terminal' | 'panel' | 'picker'
  left: number
  top: number
  canCopy: boolean
}

let xtermCssReady = false
function ensureXtermCss(): void {
  if (xtermCssReady) return
  xtermCssReady = true
  const style = document.createElement('style')
  style.dataset.dshLocalTerminalXterm = ''
  style.textContent = XTERM_CSS
  document.head.append(style)
}

function TerminalSession({
  session,
  visible,
  focused,
  onStatus,
  onActions,
  onFindRequest,
  onTerminalMenu,
}: {
  session: TerminalSessionModel
  visible: boolean
  focused: boolean
  onStatus: (id: number, status: string) => void
  onActions: (id: number, actions: TerminalActions | null) => void
  onFindRequest: (id: number) => void
  onTerminalMenu: (id: number, left: number, top: number, canCopy: boolean) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const connectionRef = useRef<LocalTerminalConnection | null>(null)
  const visibleRef = useRef(visible)
  const focusedRef = useRef(focused)
  const sawDisconnectRef = useRef(false)

  useEffect(() => { visibleRef.current = visible }, [visible])
  useEffect(() => { focusedRef.current = focused }, [focused])

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    let disposed = false
    let disposeTerminal: (() => void) | undefined

    void document.fonts.load('400 13px "MesloLGS Nerd Font Mono"')
      .catch(() => [])
      .then(() => {
        if (disposed) return
        const term = new Terminal({
          allowProposedApi: true,
          cursorBlink: true,
          convertEol: false,
          fontSize: 13,
          lineHeight: 1.15,
          letterSpacing: 0,
          scrollback: 10000,
          fontFamily: '"MesloLGS Nerd Font Mono", "MesloLGS NF", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontWeight: '400',
          fontWeightBold: '700',
          customGlyphs: true,
          rescaleOverlappingGlyphs: false,
          theme: {
            background: '#081020',
            foreground: '#e8edf8',
            cursor: '#f0dcac',
            cursorAccent: '#081020',
            selectionBackground: '#6689c866',
          },
        })
        const fit = new FitAddon()
        const unicode11 = new Unicode11Addon()
        const search = new SearchAddon()
        const serialize = new SerializeAddon()
        term.loadAddon(fit)
        term.loadAddon(unicode11)
        term.loadAddon(search)
        term.loadAddon(serialize)
        term.unicode.activeVersion = '11'
        term.open(host)
        fit.fit()
        const connection = openTerminal(session.cwd, term.cols, term.rows, session.sessionId)
        termRef.current = term
        fitRef.current = fit
        connectionRef.current = connection
        const pasteFromClipboard = (): void => {
          void navigator.clipboard.readText()
            .then(text => { if (text !== '') term.paste(text) })
            .catch(() => { /* clipboard unavailable */ })
        }
        onActions(session.id, {
          clear: () => { term.clear() },
          focus: () => { term.focus() },
          findNext: query => query === '' ? true : search.findNext(query),
          findPrevious: query => query === '' ? true : search.findPrevious(query),
          copy: () => {
            const selection = term.getSelection()
            if (selection !== '') void navigator.clipboard.writeText(selection).catch(() => { /* clipboard unavailable */ })
          },
          copyAsHtml: () => {
            const html = serialize.serializeAsHTML()
            const plain = serialize.serialize()
            if (typeof ClipboardItem !== 'undefined' && navigator.clipboard !== undefined) {
              void navigator.clipboard.write([
                new ClipboardItem({
                  'text/html': new Blob([html], { type: 'text/html' }),
                  'text/plain': new Blob([plain], { type: 'text/plain' }),
                }),
              ]).catch(() => { void navigator.clipboard.writeText(plain) })
            } else {
              void navigator.clipboard?.writeText(plain)
            }
          },
          paste: pasteFromClipboard,
          selectAll: () => { term.selectAll() },
          hasSelection: () => term.hasSelection(),
        })

        term.attachCustomKeyEventHandler(event => {
          if (event.type !== 'keydown') return true
          const primary = event.metaKey || event.ctrlKey
          if (!primary || event.altKey) return true
          if (event.code === 'KeyV' && (event.metaKey || event.shiftKey)) {
            pasteFromClipboard()
            return false
          }
          if (event.code === 'KeyF' && event.shiftKey) {
            onFindRequest(session.id)
            return false
          }
          if (event.code === 'KeyA' && (event.metaKey || event.shiftKey)) {
            term.selectAll()
            return false
          }
          if (event.code === 'KeyK' && (event.metaKey || event.shiftKey)) {
            term.clear()
            return false
          }
          return true
        })

        const data = term.onData(value => { connection.send(value) })
        connection.onReady = (cwd, _shell, replayed) => {
          if (sawDisconnectRef.current) {
            sawDisconnectRef.current = false
            term.reset()
          }
          onStatus(session.id, cwd)
          if (!focusedRef.current) return
          requestAnimationFrame(() => {
            fit.fit()
            connection.resize(term.cols, term.rows)
            term.focus()
          })
        }
        connection.onState = state => {
          if (state === 'reconnecting') {
            sawDisconnectRef.current = true
            onStatus(session.id, 'Reconnecting…')
          }
        }
        connection.onOutput = value => { term.write(value) }
        connection.onExit = (code, error) => {
          term.options.disableStdin = true
          onStatus(session.id, error ?? `zsh exited (${code ?? 'unknown'})`)
        }
        const resize = new ResizeObserver(() => {
          if (!visibleRef.current) return
          requestAnimationFrame(() => {
            try {
              fit.fit()
              connection.resize(term.cols, term.rows)
            } catch { /* panel is transitioning */ }
          })
        })
        resize.observe(host)
        disposeTerminal = () => {
          resize.disconnect()
          data.dispose()
          connection.close()
          onActions(session.id, null)
          connectionRef.current = null
          term.dispose()
          termRef.current = null
          fitRef.current = null
        }
      })

    return () => {
      disposed = true
      disposeTerminal?.()
    }
  }, [onActions, onStatus, session.cwd, session.id, session.restart, session.sessionId])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      const term = termRef.current
      const fit = fitRef.current
      if (term === null || fit === null) return
      fit.fit()
      connectionRef.current?.resize(term.cols, term.rows)
      if (focused) term.focus()
    })
  }, [focused, visible])

  return (
    <div className={css.terminalView} data-active={visible ? 'true' : undefined} aria-hidden={!visible}>
      <div
        className={css.terminalHost}
        ref={hostRef}
        onContextMenu={event => {
          event.preventDefault()
          event.stopPropagation()
          onTerminalMenu(session.id, event.clientX, event.clientY, termRef.current?.hasSelection() ?? false)
        }}
      />
    </div>
  )
}

export function TerminalPanel({ controller }: { controller: TerminalController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [restored] = useState(loadTerminalState)
  const [sessions, setSessions] = useState<TerminalSessionModel[]>(() =>
    restored.sessions.map(session => ({
      id: session.id,
      sessionId: session.sessionId ?? newSessionId(),
      name: session.name,
      cwd: session.cwd,
      restart: 0,
    })))
  const [activeId, setActiveId] = useState<number | null>(() =>
    restored.activeId !== null && restored.sessions.some(session => session.id === restored.activeId)
      ? restored.activeId
      : restored.sessions[0]?.id ?? null)
  const [groups, setGroups] = useState<number[][]>(() => {
    const covered = new Set<number>()
    const list: number[][] = []
    for (const raw of restored.groups ?? []) {
      const members = raw.filter(id => !covered.has(id) && restored.sessions.some(session => session.id === id))
      if (members.length === 0) continue
      for (const id of members) covered.add(id)
      list.push(members)
    }
    for (const session of restored.sessions) {
      if (!covered.has(session.id)) list.push([session.id])
    }
    return list
  })
  const [statuses, setStatuses] = useState<Record<number, string>>({})
  const [contextMenu, setContextMenu] = useState<TerminalContextMenu | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragMetrics, setDragMetrics] = useState<{ top: number; stride: number; source: number } | null>(null)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFound, setSearchFound] = useState(true)
  const [renameDraft, setRenameDraft] = useState('')
  const [railSide, setRailSide] = useState<'left' | 'right'>(() => restored.railSide ?? 'right')
  const [railVisible, setRailVisible] = useState<boolean>(() => restored.railVisible ?? true)
  const usedIdsRef = useRef<Set<number> | null>(null)
  const actionsRef = useRef(new Map<number, TerminalActions>())
  const panelRef = useRef<HTMLElement | null>(null)
  const railRef = useRef<HTMLElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const railResizeCleanupRef = useRef<(() => void) | null>(null)
  const splitResizeCleanupRef = useRef<(() => void) | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const insertIndexRef = useRef<number | null>(null)
  const renameCancelledRef = useRef(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const groupsRef = useRef<number[][]>(groups)
  const railSideRef = useRef<'left' | 'right'>(railSide)
  const railVisibleRef = useRef<boolean>(railVisible)

  useEffect(() => { groupsRef.current = groups }, [groups])
  useEffect(() => { railSideRef.current = railSide }, [railSide])
  useEffect(() => { railVisibleRef.current = railVisible }, [railVisible])

  useEffect(() => { ensureXtermCss() }, [])

  useEffect(() => {
    usedIdsRef.current = new Set(sessions.map(session => session.id))
  }, [sessions])

  const allocateId = (): number => {
    const used = usedIdsRef.current ?? (usedIdsRef.current = new Set(sessions.map(session => session.id)))
    let id = 1
    while (used.has(id)) id++
    used.add(id)
    return id
  }

  const addSession = useCallback((cwd?: string) => {
    const id = allocateId()
    setSessions(previous => [...previous, { id, sessionId: newSessionId(), name: `zsh ${id}`, cwd, restart: 0 }])
    setStatuses(previous => ({ ...previous, [id]: 'Starting zsh...' }))
    setGroups(previous => [...previous, [id]])
    setActiveId(id)
  }, [])

  useEffect(() => {
    if (snapshot.open && sessions.length === 0) addSession(snapshot.cwd)
  }, [addSession, sessions.length, snapshot.cwd, snapshot.open])

  const persistState = useCallback((open: boolean, active: number | null, list: TerminalSessionModel[]) => {
    const mount = panelRef.current?.parentElement
    const readVariable = (name: string, element: HTMLElement | null | undefined): string | undefined => {
      if (!(element instanceof HTMLElement)) return undefined
      const value = element.style.getPropertyValue(name)
      return value === '' ? undefined : value
    }
    saveTerminalState({
      open,
      height: readVariable('--dsh-terminal-height', mount),
      railWidth: readVariable('--dsh-terminal-rail-width', mount),
      railSide: railSideRef.current,
      railVisible: railVisibleRef.current,
      groups: groupsRef.current,
      splitRatio: readVariable('--dsh-terminal-split-ratio', stageRef.current),
      activeId: active,
      sessions: list.map((session): PersistedSession => ({ id: session.id, sessionId: session.sessionId, name: session.name, cwd: session.cwd })),
    })
  }, [])

  useEffect(() => {
    if (restored.open) controller.show()
  }, [controller, restored.open])

  useEffect(() => {
    const mount = panelRef.current?.parentElement
    if (!(mount instanceof HTMLElement)) return
    if (restored.height !== undefined && restored.height !== '') {
      mount.style.setProperty('--dsh-terminal-height', restored.height)
    }
    if (restored.railWidth !== undefined && restored.railWidth !== '') {
      mount.style.setProperty('--dsh-terminal-rail-width', restored.railWidth)
    }
  }, [restored.height, restored.railWidth])

  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    if (restored.splitRatio !== undefined && restored.splitRatio !== '') {
      stage.style.setProperty('--dsh-terminal-split-ratio', restored.splitRatio)
    }
  }, [restored.splitRatio])

  useEffect(() => {
    persistState(snapshot.open, activeId, sessions)
  }, [activeId, groups, persistState, railSide, railVisible, sessions, snapshot.open])

  const onStatus = useCallback((id: number, status: string) => {
    setStatuses(previous => previous[id] === status ? previous : { ...previous, [id]: status })
  }, [])

  const onActions = useCallback((id: number, actions: TerminalActions | null) => {
    if (actions === null) actionsRef.current.delete(id)
    else actionsRef.current.set(id, actions)
  }, [])

  const closeUnit = (group: number[]): void => {
    const ids = new Set(group)
    for (const id of group) usedIdsRef.current?.delete(id)
    const remaining = sessions.filter(session => !ids.has(session.id))
    setSessions(remaining)
    setStatuses(previous => {
      const next = { ...previous }
      for (const id of group) delete next[id]
      return next
    })
    setGroups(previous => previous.filter(candidate => candidate !== group))
    if (activeId !== null && ids.has(activeId)) setActiveId(remaining[0]?.id ?? null)
    if (remaining.length === 0) controller.hide()
  }

  const splitUnit = (group: number[]): void => {
    if (group.length >= 6) return
    const focused = activeId !== null && group.includes(activeId)
      ? sessions.find(session => session.id === activeId)
      : sessions.find(session => session.id === group[0])
    const id = allocateId()
    setSessions(previous => [...previous, {
      id,
      sessionId: newSessionId(),
      name: focused?.name ?? `zsh ${id}`,
      cwd: focused?.cwd,
      restart: 0,
    }])
    setStatuses(previous => ({ ...previous, [id]: 'Starting zsh...' }))
    setGroups(previous => previous.map(candidate => candidate === group ? [...candidate, id] : candidate))
    setActiveId(id)
  }

  const joinUnit = (group: number[]): void => {
    if (group.length <= 1) return
    setGroups(previous => previous.flatMap(candidate => candidate === group ? group.map(id => [id]) : [candidate]))
  }

  const focusUnit = (group: number[]): void => {
    if (group.includes(activeId ?? -1)) return
    const first = group[0]
    if (first !== undefined) setActiveId(first)
  }

  const startSplitResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const activeGroup = activeId === null ? undefined : groups.find(group => group.includes(activeId))
    if (activeGroup === undefined || activeGroup.length !== 2) return
    event.preventDefault()
    splitResizeCleanupRef.current?.()
    const stage = stageRef.current
    if (stage === null) return
    const rect = stage.getBoundingClientRect()
    if (rect.width <= 0) return
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const setRatio = (x: number): void => {
      const ratio = Math.min(0.75, Math.max(0.25, (x - rect.left) / rect.width))
      stage.style.setProperty('--dsh-terminal-split-ratio', `${(ratio * 100).toFixed(2)}%`)
    }
    const move = (moveEvent: PointerEvent): void => { setRatio(moveEvent.clientX) }
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.dispatchEvent(new Event('resize'))
      persistState(snapshot.open, activeId, sessions)
      splitResizeCleanupRef.current = null
    }
    splitResizeCleanupRef.current = finish
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const startSessionDrag = (event: ReactPointerEvent<HTMLDivElement>, unitKey: number): void => {
    if (event.button !== 0) return
    const target = event.target
    if (target instanceof Element && (target.closest(`.${css.sessionClose}`) || target.closest(`.${css.sessionEditor}`))) return
    const index = groups.findIndex(group => group[0] === unitKey)
    if (index < 0) return
    const rail = railRef.current
    if (rail === null) return
    event.preventDefault()
    dragCleanupRef.current?.()
    setContextMenu(null)
    const rows = Array.from(rail.querySelectorAll<HTMLElement>(`.${css.sessionRow}`))
    const firstRow = rows[0]
    if (firstRow === undefined) return
    const stride = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : 28
    const listTop = rail.getBoundingClientRect().top + firstRow.offsetTop
    const count = groups.length
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    rail.dataset.dragging = 'true'
    setDragMetrics({ top: firstRow.offsetTop, stride, source: index })
    setDragId(unitKey)
    const computeInsertIndex = (pointerY: number): number =>
      Math.max(0, Math.min(count, Math.round((pointerY - listTop) / stride)))
    const applyInsertIndex = (next: number): void => {
      if (insertIndexRef.current === next) return
      insertIndexRef.current = next
      setInsertIndex(next)
    }
    applyInsertIndex(computeInsertIndex(event.clientY))
    const move = (moveEvent: PointerEvent): void => { applyInsertIndex(computeInsertIndex(moveEvent.clientY)) }
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      delete rail.dataset.dragging
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      const dropIndex = insertIndexRef.current
      insertIndexRef.current = null
      dragCleanupRef.current = null
      setDragId(null)
      setInsertIndex(null)
      setDragMetrics(null)
      if (dropIndex !== null) {
        const targetIndex = dropIndex > index ? dropIndex - 1 : dropIndex
        if (targetIndex !== index) {
          setGroups(previous => {
            const next = previous.slice()
            const [item] = next.splice(index, 1)
            next.splice(targetIndex, 0, item)
            return next
          })
        }
      }
    }
    dragCleanupRef.current = finish
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const openContextMenu = (event: ReactMouseEvent, unitKey: number): void => {
    event.preventDefault()
    event.stopPropagation()
    const group = groups.find(candidate => candidate[0] === unitKey)
    if (group !== undefined) focusUnit(group)
    // Keep the menu fully inside the viewport; stick to the page edge when it
    // would overflow. Height tracks the item count (26px per item + padding).
    const menuWidth = 140
    const itemCount = 2
      + (group !== undefined && group.length < 6 ? 1 : 0)
      + (group !== undefined && group.length > 1 ? 1 : 0)
    const menuHeight = itemCount * 26 + 10
    const margin = 6
    setContextMenu({
      id: unitKey,
      kind: 'session',
      canCopy: false,
      left: Math.max(margin, Math.min(event.clientX, window.innerWidth - menuWidth - margin)),
      top: Math.max(margin, Math.min(event.clientY, window.innerHeight - menuHeight - margin)),
    })
  }

  const openPanelMenu = (event: ReactMouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    // 26px per item + padding/border; Hide Tabs joins while the rail shows.
    const menuWidth = 140
    const itemCount = 2 + (railVisible ? 1 : 0)
    const menuHeight = itemCount * 26 + 10
    const margin = 6
    setContextMenu({
      id: -1,
      kind: 'panel',
      canCopy: false,
      left: Math.max(margin, Math.min(event.clientX, window.innerWidth - menuWidth - margin)),
      top: Math.max(margin, Math.min(event.clientY, window.innerHeight - menuHeight - margin)),
    })
  }

  const pickUnit = (group: number[]): void => {
    const first = group[0]
    if (first !== undefined) setActiveId(first)
    controller.show()
  }

  const openPickerMenu = (event: ReactMouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 180
    const itemCount = groups.length + 1 // one entry per unit plus Show Tabs
    const menuHeight = Math.min(itemCount * 26 + 10, 264)
    const margin = 6
    setContextMenu({
      id: -1,
      kind: 'picker',
      canCopy: false,
      left: Math.max(margin, Math.min(event.clientX, window.innerWidth - menuWidth - margin)),
      top: Math.max(margin, Math.min(event.clientY, window.innerHeight - menuHeight - margin)),
    })
  }

  const openTerminalMenu = useCallback((id: number, left: number, top: number, canCopy: boolean): void => {
    setActiveId(id)
    // 26px per item + padding/border; Show Tabs joins while the rail is hidden.
    const menuWidth = 140
    const itemCount = 6 + (railVisible ? 0 : 1)
    const menuHeight = itemCount * 26 + 10
    const margin = 6
    setContextMenu({
      id,
      kind: 'terminal',
      canCopy,
      left: Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - menuHeight - margin)),
    })
  }, [railVisible])

  const beginRename = (unitKey: number): void => {
    const session = sessions.find(candidate => candidate.id === unitKey)
    if (session === undefined) return
    renameCancelledRef.current = false
    setRenameDraft(session.name)
    setEditingId(unitKey)
    setContextMenu(null)
  }

  const commitRename = (unitKey: number): void => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false
      setEditingId(null)
      return
    }
    const name = renameDraft.trim()
    if (name !== '') {
      const group = groups.find(candidate => candidate[0] === unitKey)
      if (group !== undefined) {
        const ids = new Set(group)
        setSessions(previous => previous.map(session => ids.has(session.id) ? { ...session, name } : session))
      }
    }
    setEditingId(null)
  }

  const handleRenameKey = (event: ReactKeyboardEvent<HTMLInputElement>, id: number): void => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      commitRename(id)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      renameCancelledRef.current = true
      setEditingId(null)
    }
  }

  const setPanelHeight = (height: number): void => {
    const mount = panelRef.current?.parentElement
    if (!(mount instanceof HTMLElement)) return
    const maximum = Math.max(260, Math.round(window.innerHeight * 0.72))
    mount.style.setProperty('--dsh-terminal-height', `${Math.min(maximum, Math.max(180, Math.round(height)))}px`)
  }

  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    resizeCleanupRef.current?.()
    const mount = panelRef.current?.parentElement
    if (!(mount instanceof HTMLElement)) return
    const startY = event.clientY
    const startHeight = mount.getBoundingClientRect().height
    const previousUserSelect = document.body.style.userSelect
    mount.dataset.resizing = 'true'
    document.body.style.userSelect = 'none'
    const move = (moveEvent: PointerEvent): void => {
      setPanelHeight(startHeight + startY - moveEvent.clientY)
    }
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      delete mount.dataset.resizing
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.dispatchEvent(new Event('resize'))
      resizeCleanupRef.current = null
      persistState(snapshot.open, activeId, sessions)
    }
    resizeCleanupRef.current = finish
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const mount = panelRef.current?.parentElement
    if (!(mount instanceof HTMLElement)) return
    const delta = event.key === 'ArrowUp' ? 24 : -24
    setPanelHeight(mount.getBoundingClientRect().height + delta)
    persistState(snapshot.open, activeId, sessions)
  }

  const setRailWidth = (width: number): void => {
    const mount = panelRef.current?.parentElement
    if (!(mount instanceof HTMLElement)) return
    const maximum = Math.round(window.innerWidth * 0.5)
    mount.style.setProperty('--dsh-terminal-rail-width', `${Math.min(maximum, Math.max(116, Math.round(width)))}px`)
  }

  const startRailResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    railResizeCleanupRef.current?.()
    const mount = panelRef.current?.parentElement
    const rail = railRef.current
    if (!(mount instanceof HTMLElement) || rail === null) return
    const startX = event.clientX
    const startWidth = rail.getBoundingClientRect().width
    const previousUserSelect = document.body.style.userSelect
    mount.dataset.resizing = 'true'
    document.body.style.userSelect = 'none'
    const move = (moveEvent: PointerEvent): void => {
      setRailWidth(railSideRef.current === 'left'
        ? startWidth + moveEvent.clientX - startX
        : startWidth + startX - moveEvent.clientX)
    }
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      delete mount.dataset.resizing
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.dispatchEvent(new Event('resize'))
      railResizeCleanupRef.current = null
      persistState(snapshot.open, activeId, sessions)
    }
    railResizeCleanupRef.current = finish
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const resizeRailWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const rail = railRef.current
    if (rail === null) return
    const shrink = railSide === 'right' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft'
    const delta = shrink ? -24 : 24
    setRailWidth(rail.getBoundingClientRect().width + delta)
    persistState(snapshot.open, activeId, sessions)
  }

  const restartActive = (): void => {
    if (activeId === null) return
    setStatuses(previous => ({ ...previous, [activeId]: 'Restarting zsh...' }))
    setSessions(previous => previous.map(session => session.id === activeId
      ? { ...session, sessionId: newSessionId(), restart: session.restart + 1 }
      : session))
  }

  const activeStatus = activeId === null ? '' : statuses[activeId] ?? ''

  const activeGroup = activeId === null ? undefined : groups.find(group => group.includes(activeId))
  const activeGroupMembers = activeGroup === undefined
    ? []
    : activeGroup.flatMap(id => {
      const session = sessions.find(candidate => candidate.id === id)
      return session === undefined ? [] : [session]
    })
  const menuGroup = contextMenu !== null && contextMenu.kind === 'session'
    ? groups.find(group => group[0] === contextMenu.id)
    : undefined

  const openSearch = useCallback((id: number): void => {
    setActiveId(id)
    setSearchQuery('')
    setSearchFound(true)
    setSearchOpen(true)
  }, [])

  const handleSearchChange = (value: string): void => {
    setSearchQuery(value)
  }

  const searchPrevious = (): void => {
    if (searchQuery === '') return
    const actions = activeId === null ? undefined : actionsRef.current.get(activeId)
    if (actions !== undefined) setSearchFound(actions.findPrevious(searchQuery))
  }

  const searchNext = (): void => {
    if (searchQuery === '') return
    const actions = activeId === null ? undefined : actionsRef.current.get(activeId)
    if (actions !== undefined) setSearchFound(actions.findNext(searchQuery))
  }

  const closeSearch = (): void => {
    setSearchOpen(false)
    if (activeId !== null) actionsRef.current.get(activeId)?.focus()
  }

  useEffect(() => {
    if (!searchOpen || searchQuery === '' || activeId === null) return
    const actions = actionsRef.current.get(activeId)
    if (actions !== undefined) setSearchFound(actions.findNext(searchQuery))
  }, [activeId, searchOpen, searchQuery])

  const dragIndicatorTop = dragMetrics !== null && insertIndex !== null
    && insertIndex !== dragMetrics.source && insertIndex !== dragMetrics.source + 1
    ? dragMetrics.top + insertIndex * dragMetrics.stride - 2
    : null

  useEffect(() => {
    if (contextMenu === null) return
    const close = (event: MouseEvent): void => {
      if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return
      setContextMenu(null)
    }
    window.addEventListener('mousedown', close)
    return () => { window.removeEventListener('mousedown', close) }
  }, [contextMenu])

  useEffect(() => () => {
    resizeCleanupRef.current?.()
    railResizeCleanupRef.current?.()
    splitResizeCleanupRef.current?.()
    dragCleanupRef.current?.()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !snapshot.open) return
      if (contextMenu !== null) setContextMenu(null)
      else if (searchOpen) closeSearch()
      else if (editingId !== null) setEditingId(null)
      else controller.hide()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [activeId, contextMenu, controller, editingId, searchOpen, snapshot.open])

  const railContent = (
    <>
      {groups.map(group => {
        const member = sessions.find(session => session.id === group[0])
        if (member === undefined) return null
        const unitKey = member.id
        const groupActive = group.includes(activeId ?? -1)
        return (
          <div
            key={unitKey}
            className={css.sessionRow}
            data-active={groupActive ? 'true' : undefined}
            data-dragging={dragId === unitKey ? 'true' : undefined}
            onContextMenu={event => { openContextMenu(event, unitKey) }}
            onPointerDown={event => { startSessionDrag(event, unitKey) }}
          >
            {editingId === unitKey
              ? <div className={css.sessionEditor}><TerminalIcon /><input autoFocus value={renameDraft} aria-label={`Rename ${member.name}`} onChange={event => { setRenameDraft(event.target.value) }} onKeyDown={event => { handleRenameKey(event, unitKey) }} onBlur={() => { commitRename(unitKey) }} /></div>
              : <button type="button" className={css.sessionSelect} onClick={() => { focusUnit(group) }} title={groupActive && activeId !== null ? statuses[activeId] : statuses[member.id]}><TerminalIcon /><span>{member.name}</span>{group.length > 1 && <span className={css.unitCount}>{group.length}</span>}</button>}
            <button type="button" className={css.sessionClose} aria-label={`Close ${member.name}`} title={`Close ${member.name}`} onClick={() => { closeUnit(group) }}>×</button>
          </div>
        )
      })}
      {dragIndicatorTop !== null && (
        <div className={css.dragIndicator} style={{ top: dragIndicatorTop }} />
      )}
    </>
  )

  const activeUnitLabel = (() => {
    const group = activeId === null ? undefined : groups.find(candidate => candidate.includes(activeId))
    const member = group === undefined ? undefined : sessions.find(session => session.id === group[0])
    return member?.name ?? 'Terminal'
  })()

  return (
    <>
      <section ref={panelRef} className={css.panel} data-open={snapshot.open ? 'true' : undefined} data-search={searchOpen ? 'true' : undefined} aria-hidden={!snapshot.open} aria-label="Local zsh terminals">
      <div
        className={css.resizeHandle}
        role="separator"
        aria-label="Resize terminal panel"
        aria-orientation="horizontal"
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
        onDoubleClick={() => {
          panelRef.current?.parentElement?.style.removeProperty('--dsh-terminal-height')
          persistState(snapshot.open, activeId, sessions)
        }}
      />
      <header className={css.panelHeader}>
        <div className={css.panelTitle}>
          <TerminalIcon />
          <strong>Terminal</strong>
          <span className={css.cwd} title={activeStatus}>{activeStatus}</span>
        </div>
        <div className={css.panelActions}>
          <button type="button" className={css.iconButton} aria-label="Create terminal" title="Create terminal" onClick={() => { addSession(snapshot.cwd) }}>+</button>
          <button type="button" className={css.headerButton} onClick={() => { if (activeId !== null) openSearch(activeId) }}>Find</button>
          <button type="button" className={css.headerButton} onClick={() => { if (activeId !== null) actionsRef.current.get(activeId)?.clear() }}>Clear</button>
          <button type="button" className={css.headerButton} onClick={restartActive}>Restart</button>
          <button type="button" className={css.closeButton} aria-label="Hide terminal panel" title="Hide terminal panel" onClick={() => { controller.hide() }}>×</button>
        </div>
      </header>
      {searchOpen && (
        <div className={css.searchBar}>
          <input
            autoFocus
            value={searchQuery}
            data-notfound={searchFound ? undefined : 'true'}
            placeholder="Find"
            aria-label="Find in terminal"
            onChange={event => { handleSearchChange(event.target.value) }}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (event.shiftKey) searchPrevious()
              else searchNext()
            }}
          />
          <button type="button" className={css.searchNav} aria-label="Previous match" title="Previous match" onClick={searchPrevious}>↑</button>
          <button type="button" className={css.searchNav} aria-label="Next match" title="Next match" onClick={searchNext}>↓</button>
          <button type="button" className={css.searchNav} aria-label="Close search" title="Close search" onClick={closeSearch}>×</button>
        </div>
      )}
      <div className={css.panelBody} data-rail={railVisible ? railSide : 'hidden'}>
        {railVisible && railSide === 'left' && (
          <aside ref={railRef} className={css.sessionRail} aria-label="Terminal sessions" onScroll={() => { setContextMenu(null); dragCleanupRef.current?.() }} onContextMenu={openPanelMenu}>
            {railContent}
          </aside>
        )}
        <div
          className={css.railDivider}
          role="separator"
          aria-label="Resize terminal session list"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={startRailResize}
          onKeyDown={resizeRailWithKeyboard}
          onDoubleClick={() => {
            panelRef.current?.parentElement?.style.removeProperty('--dsh-terminal-rail-width')
            persistState(snapshot.open, activeId, sessions)
          }}
        />
        <div ref={stageRef} className={css.terminalStage} onContextMenu={openPanelMenu}>
          {activeGroup !== undefined && activeGroupMembers.length > 1 && (
            <div
              className={css.splitGrid}
              style={{ gridTemplateColumns: activeGroupMembers.length === 2
                ? 'var(--dsh-terminal-split-ratio, 50%) 7px minmax(0, 1fr)'
                : Array.from({ length: activeGroupMembers.length }, () => 'minmax(0, 1fr)').join(' 7px ') }}
            >
              {activeGroupMembers.map((member, index) => (
                <Fragment key={member.id}>
                  {index > 0 && (
                    <div
                      className={css.splitDivider}
                      data-static={activeGroupMembers.length > 2 ? 'true' : undefined}
                      role="separator"
                      aria-label="Resize split terminals"
                      aria-orientation="vertical"
                      onPointerDown={startSplitResize}
                      onDoubleClick={() => {
                        stageRef.current?.style.removeProperty('--dsh-terminal-split-ratio')
                        persistState(snapshot.open, activeId, sessions)
                      }}
                    />
                  )}
                  <div
                    className={css.splitPane}
                    data-focused={activeId === member.id ? 'true' : undefined}
                    onPointerDownCapture={() => { setActiveId(member.id) }}
                  >
                    <TerminalSession
                      key={`${member.id}:${member.restart}`}
                      session={member}
                      visible={snapshot.open}
                      focused={snapshot.open && activeId === member.id}
                      onStatus={onStatus}
                      onActions={onActions}
                      onFindRequest={openSearch}
                      onTerminalMenu={openTerminalMenu}
                    />
                  </div>
                </Fragment>
              ))}
            </div>
          )}
          {sessions.map(session => {
            if (activeGroup !== undefined && activeGroupMembers.length > 1 && activeGroup.includes(session.id)) return null
            return (
              <TerminalSession
                key={`${session.id}:${session.restart}`}
                session={session}
                visible={snapshot.open && session.id === activeId}
                focused={snapshot.open && session.id === activeId}
                onStatus={onStatus}
                onActions={onActions}
                onFindRequest={openSearch}
                onTerminalMenu={openTerminalMenu}
              />
            )
          })}
        </div>
        {railVisible && railSide === 'right' && (
          <aside ref={railRef} className={css.sessionRail} aria-label="Terminal sessions" onScroll={() => { setContextMenu(null); dragCleanupRef.current?.() }} onContextMenu={openPanelMenu}>
            {railContent}
          </aside>
        )}
        {contextMenu !== null && createPortal(
          <div ref={contextMenuRef} className={css.contextMenu} role="menu" data-tall={contextMenu.kind === 'picker' ? 'true' : undefined} style={{ left: contextMenu.left, top: contextMenu.top }}>
            {contextMenu.kind === 'session'
              ? <>
                <button type="button" role="menuitem" onClick={() => { beginRename(contextMenu.id) }}>Rename</button>
                <button type="button" role="menuitem" onClick={() => {
                  const group = groups.find(candidate => candidate[0] === contextMenu.id)
                  if (group !== undefined) closeUnit(group)
                  setContextMenu(null)
                }}>Close</button>
                {menuGroup !== undefined && menuGroup.length < 6 && (
                  <button type="button" role="menuitem" onClick={() => { splitUnit(menuGroup); setContextMenu(null) }}>Split Terminal</button>
                )}
                {menuGroup !== undefined && menuGroup.length > 1 && (
                  <button type="button" role="menuitem" onClick={() => { joinUnit(menuGroup); setContextMenu(null) }}>Join Terminals</button>
                )}
              </>
              : contextMenu.kind === 'panel'
                ? <>
                  <button type="button" role="menuitem" onClick={() => { addSession(snapshot.cwd); setContextMenu(null) }}>New Terminal</button>
                  <button type="button" role="menuitem" onClick={() => { setRailSide(side => side === 'right' ? 'left' : 'right'); setContextMenu(null) }}>
                    {railSide === 'right' ? 'Move Tabs Left' : 'Move Tabs Right'}
                  </button>
                  {railVisible && (
                    <button type="button" role="menuitem" onClick={() => { setRailVisible(false); setContextMenu(null) }}>Hide Tabs</button>
                  )}
                </>
                : contextMenu.kind === 'picker'
                  ? <>
                    {groups.map(group => {
                      const member = sessions.find(session => session.id === group[0])
                      if (member === undefined) return null
                      const active = group.includes(activeId ?? -1)
                      return (
                        <button key={member.id} type="button" role="menuitem" onClick={() => { pickUnit(group); setContextMenu(null) }}>
                          {active ? '✓ ' : ''}{member.name}
                        </button>
                      )
                    })}
                    <button type="button" role="menuitem" onClick={() => { setRailVisible(true); controller.show(); setContextMenu(null) }}>Show Tabs</button>
                  </>
                  : <>
                    <button type="button" role="menuitem" disabled={!contextMenu.canCopy} onClick={() => { actionsRef.current.get(contextMenu.id)?.copy(); setContextMenu(null) }}>Copy</button>
                    <button type="button" role="menuitem" onClick={() => { actionsRef.current.get(contextMenu.id)?.copyAsHtml(); setContextMenu(null) }}>Copy as HTML</button>
                    <button type="button" role="menuitem" onClick={() => { actionsRef.current.get(contextMenu.id)?.paste(); setContextMenu(null) }}>Paste</button>
                    <button type="button" role="menuitem" onClick={() => { actionsRef.current.get(contextMenu.id)?.selectAll(); setContextMenu(null) }}>Select All</button>
                    <button type="button" role="menuitem" onClick={() => { actionsRef.current.get(contextMenu.id)?.clear(); setContextMenu(null) }}>Clear</button>
                    <button type="button" role="menuitem" onClick={() => { restartActive(); setContextMenu(null) }}>Restart</button>
                    {!railVisible && (
                      <button type="button" role="menuitem" onClick={() => { setRailVisible(true); setContextMenu(null) }}>Show Tabs</button>
                    )}
                  </>}
          </div>,
          document.body,
        )}
      </div>
    </section>
    {(!snapshot.open || !railVisible) && sessions.length > 0 && createPortal(
      <button type="button" className={css.statusEntry} onClick={openPickerMenu}>
        <TerminalIcon />
        <span>{activeUnitLabel}</span>
      </button>,
      document.body,
    )}
    </>
  )
}
