import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { openTerminal, type LocalTerminalConnection } from './api.ts'
import type { TerminalController } from './controller.ts'
import { loadTerminalState, saveTerminalState, type PersistedSession } from './storage.ts'
import { TerminalIcon } from './TerminalButton.tsx'
import { XTERM_CSS } from './xterm-css.ts'
import css from './terminal.module.css'

interface TerminalSessionModel {
  id: number
  name: string
  cwd?: string
  restart: number
}

interface TerminalActions {
  clear(): void
}

interface TerminalContextMenu {
  id: number
  left: number
  top: number
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
  active,
  onStatus,
  onActions,
}: {
  session: TerminalSessionModel
  active: boolean
  onStatus: (id: number, status: string) => void
  onActions: (id: number, actions: TerminalActions | null) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const connectionRef = useRef<LocalTerminalConnection | null>(null)
  const activeRef = useRef(active)

  useEffect(() => { activeRef.current = active }, [active])

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
        term.loadAddon(fit)
        term.loadAddon(unicode11)
        term.unicode.activeVersion = '11'
        term.open(host)
        fit.fit()
        const connection = openTerminal(session.cwd, term.cols, term.rows)
        termRef.current = term
        fitRef.current = fit
        connectionRef.current = connection
        onActions(session.id, { clear: () => { term.clear() } })

        const data = term.onData(value => { connection.send(value) })
        connection.onReady = cwd => {
          onStatus(session.id, cwd)
          if (!activeRef.current) return
          requestAnimationFrame(() => {
            fit.fit()
            connection.resize(term.cols, term.rows)
            term.focus()
          })
        }
        connection.onOutput = value => { term.write(value) }
        connection.onExit = (code, error) => {
          term.options.disableStdin = true
          onStatus(session.id, error ?? `zsh exited (${code ?? 'unknown'})`)
        }
        const resize = new ResizeObserver(() => {
          if (!activeRef.current) return
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
  }, [onActions, onStatus, session.cwd, session.id, session.restart])

  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      const term = termRef.current
      const fit = fitRef.current
      if (term === null || fit === null) return
      fit.fit()
      connectionRef.current?.resize(term.cols, term.rows)
      term.focus()
    })
  }, [active])

  return (
    <div className={css.terminalView} data-active={active ? 'true' : undefined} aria-hidden={!active}>
      <div className={css.terminalHost} ref={hostRef} />
    </div>
  )
}

export function TerminalPanel({ controller }: { controller: TerminalController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [restored] = useState(loadTerminalState)
  const [sessions, setSessions] = useState<TerminalSessionModel[]>(() =>
    restored.sessions.map(session => ({ ...session, restart: 0 })))
  const [activeId, setActiveId] = useState<number | null>(() =>
    restored.activeId !== null && restored.sessions.some(session => session.id === restored.activeId)
      ? restored.activeId
      : restored.sessions[0]?.id ?? null)
  const [statuses, setStatuses] = useState<Record<number, string>>({})
  const [contextMenu, setContextMenu] = useState<TerminalContextMenu | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragMetrics, setDragMetrics] = useState<{ top: number; stride: number; source: number } | null>(null)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const usedIdsRef = useRef<Set<number> | null>(null)
  const actionsRef = useRef(new Map<number, TerminalActions>())
  const panelRef = useRef<HTMLElement | null>(null)
  const railRef = useRef<HTMLElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const railResizeCleanupRef = useRef<(() => void) | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const insertIndexRef = useRef<number | null>(null)
  const renameCancelledRef = useRef(false)

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
    setSessions(previous => [...previous, { id, name: `zsh ${id}`, cwd, restart: 0 }])
    setStatuses(previous => ({ ...previous, [id]: 'Starting zsh...' }))
    setActiveId(id)
  }, [])

  useEffect(() => {
    if (snapshot.open && sessions.length === 0) addSession(snapshot.cwd)
  }, [addSession, sessions.length, snapshot.cwd, snapshot.open])

  const persistState = useCallback((open: boolean, active: number | null, list: TerminalSessionModel[]) => {
    const mount = panelRef.current?.parentElement
    const readVariable = (name: string): string | undefined => {
      if (!(mount instanceof HTMLElement)) return undefined
      const value = mount.style.getPropertyValue(name)
      return value === '' ? undefined : value
    }
    saveTerminalState({
      open,
      height: readVariable('--dsh-terminal-height'),
      railWidth: readVariable('--dsh-terminal-rail-width'),
      activeId: active,
      sessions: list.map((session): PersistedSession => ({ id: session.id, name: session.name, cwd: session.cwd })),
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
    persistState(snapshot.open, activeId, sessions)
  }, [activeId, persistState, sessions, snapshot.open])

  const onStatus = useCallback((id: number, status: string) => {
    setStatuses(previous => previous[id] === status ? previous : { ...previous, [id]: status })
  }, [])

  const onActions = useCallback((id: number, actions: TerminalActions | null) => {
    if (actions === null) actionsRef.current.delete(id)
    else actionsRef.current.set(id, actions)
  }, [])

  const closeSession = (id: number): void => {
    usedIdsRef.current?.delete(id)
    const index = sessions.findIndex(session => session.id === id)
    const remaining = sessions.filter(session => session.id !== id)
    setSessions(remaining)
    setStatuses(previous => {
      const next = { ...previous }
      delete next[id]
      return next
    })
    if (activeId === id) setActiveId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null)
    if (remaining.length === 0) controller.hide()
  }

  const startSessionDrag = (event: ReactPointerEvent<HTMLDivElement>, id: number): void => {
    if (event.button !== 0) return
    const target = event.target
    if (target instanceof Element && (target.closest(`.${css.sessionClose}`) || target.closest(`.${css.sessionEditor}`))) return
    const index = sessions.findIndex(session => session.id === id)
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
    const count = sessions.length
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    rail.dataset.dragging = 'true'
    setDragMetrics({ top: firstRow.offsetTop, stride, source: index })
    setDragId(id)
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
          setSessions(previous => {
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

  const openContextMenu = (event: ReactMouseEvent, id: number): void => {
    event.preventDefault()
    setActiveId(id)
    // Keep the menu fully inside the viewport; stick to the page edge when it
    // would overflow. menuHeight must match the two 26px items + padding/border.
    const menuWidth = 140
    const menuHeight = 64
    const margin = 6
    setContextMenu({
      id,
      left: Math.max(margin, Math.min(event.clientX, window.innerWidth - menuWidth - margin)),
      top: Math.max(margin, Math.min(event.clientY, window.innerHeight - menuHeight - margin)),
    })
  }

  const beginRename = (id: number): void => {
    const session = sessions.find(candidate => candidate.id === id)
    if (session === undefined) return
    renameCancelledRef.current = false
    setRenameDraft(session.name)
    setEditingId(id)
    setContextMenu(null)
  }

  const commitRename = (id: number): void => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false
      setEditingId(null)
      return
    }
    const name = renameDraft.trim()
    if (name !== '') {
      setSessions(previous => previous.map(session => session.id === id ? { ...session, name } : session))
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
      setRailWidth(startWidth + startX - moveEvent.clientX)
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
    const delta = event.key === 'ArrowRight' ? -24 : 24
    setRailWidth(rail.getBoundingClientRect().width + delta)
    persistState(snapshot.open, activeId, sessions)
  }

  const restartActive = (): void => {
    if (activeId === null) return
    setStatuses(previous => ({ ...previous, [activeId]: 'Restarting zsh...' }))
    setSessions(previous => previous.map(session => session.id === activeId
      ? { ...session, restart: session.restart + 1 }
      : session))
  }

  const activeStatus = activeId === null ? '' : statuses[activeId] ?? ''

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
    dragCleanupRef.current?.()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !snapshot.open) return
      if (contextMenu !== null) setContextMenu(null)
      else if (editingId !== null) setEditingId(null)
      else controller.hide()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [contextMenu, controller, editingId, snapshot.open])

  return (
    <section ref={panelRef} className={css.panel} data-open={snapshot.open ? 'true' : undefined} aria-hidden={!snapshot.open} aria-label="Local zsh terminals">
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
          <button type="button" className={css.headerButton} onClick={() => { if (activeId !== null) actionsRef.current.get(activeId)?.clear() }}>Clear</button>
          <button type="button" className={css.headerButton} onClick={restartActive}>Restart</button>
          <button type="button" className={css.closeButton} aria-label="Hide terminal panel" title="Hide terminal panel" onClick={() => { controller.hide() }}>×</button>
        </div>
      </header>
      <div className={css.panelBody}>
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
        <div className={css.terminalStage}>
          {sessions.map(session => (
            <TerminalSession
              key={`${session.id}:${session.restart}`}
              session={session}
              active={snapshot.open && session.id === activeId}
              onStatus={onStatus}
              onActions={onActions}
            />
          ))}
        </div>
        <aside ref={railRef} className={css.sessionRail} aria-label="Terminal sessions" onScroll={() => { setContextMenu(null); dragCleanupRef.current?.() }}>
          {sessions.map(session => (
            <div
              key={session.id}
              className={css.sessionRow}
              data-active={session.id === activeId ? 'true' : undefined}
              data-dragging={dragId === session.id ? 'true' : undefined}
              onContextMenu={event => { openContextMenu(event, session.id) }}
              onPointerDown={event => { startSessionDrag(event, session.id) }}
            >
              {editingId === session.id
                ? <div className={css.sessionEditor}><TerminalIcon /><input autoFocus value={renameDraft} aria-label={`Rename ${session.name}`} onChange={event => { setRenameDraft(event.target.value) }} onKeyDown={event => { handleRenameKey(event, session.id) }} onBlur={() => { commitRename(session.id) }} /></div>
                : <button type="button" className={css.sessionSelect} onClick={() => { setActiveId(session.id) }} title={statuses[session.id]}><TerminalIcon /><span>{session.name}</span></button>}
              <button type="button" className={css.sessionClose} aria-label={`Close ${session.name}`} title={`Close ${session.name}`} onClick={() => { closeSession(session.id) }}>×</button>
            </div>
          ))}
          {dragIndicatorTop !== null && (
            <div className={css.dragIndicator} style={{ top: dragIndicatorTop }} />
          )}
          {contextMenu !== null && createPortal(
            <div ref={contextMenuRef} className={css.contextMenu} role="menu" style={{ left: contextMenu.left, top: contextMenu.top }}>
              <button type="button" role="menuitem" onClick={() => { beginRename(contextMenu.id) }}>Rename</button>
              <button type="button" role="menuitem" onClick={() => { closeSession(contextMenu.id); setContextMenu(null) }}>Close</button>
            </div>,
            document.body,
          )}
        </aside>
      </div>
    </section>
  )
}
