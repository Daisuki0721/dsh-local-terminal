import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { openTerminal, type LocalTerminalConnection } from './api.ts'
import type { TerminalController } from './controller.ts'
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
  const [sessions, setSessions] = useState<TerminalSessionModel[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [statuses, setStatuses] = useState<Record<number, string>>({})
  const [contextMenu, setContextMenu] = useState<TerminalContextMenu | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const nextIdRef = useRef(1)
  const actionsRef = useRef(new Map<number, TerminalActions>())
  const panelRef = useRef<HTMLElement | null>(null)
  const railRef = useRef<HTMLElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const renameCancelledRef = useRef(false)

  useEffect(() => { ensureXtermCss() }, [])

  const addSession = useCallback((cwd?: string) => {
    const id = nextIdRef.current++
    setSessions(previous => [...previous, { id, name: `zsh ${id}`, cwd, restart: 0 }])
    setStatuses(previous => ({ ...previous, [id]: 'Starting zsh...' }))
    setActiveId(id)
  }, [])

  useEffect(() => {
    if (snapshot.open && sessions.length === 0) addSession(snapshot.cwd)
  }, [addSession, sessions.length, snapshot.cwd, snapshot.open])

  const onStatus = useCallback((id: number, status: string) => {
    setStatuses(previous => previous[id] === status ? previous : { ...previous, [id]: status })
  }, [])

  const onActions = useCallback((id: number, actions: TerminalActions | null) => {
    if (actions === null) actionsRef.current.delete(id)
    else actionsRef.current.set(id, actions)
  }, [])

  const closeSession = (id: number): void => {
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

  const openContextMenu = (event: ReactMouseEvent, id: number): void => {
    event.preventDefault()
    const rail = railRef.current
    if (rail === null) return
    const rect = rail.getBoundingClientRect()
    const menuWidth = 140
    const menuHeight = 76
    setActiveId(id)
    setContextMenu({
      id,
      left: Math.max(4, Math.min(event.clientX - rect.left, rect.width - menuWidth - 4)),
      top: Math.max(4, Math.min(event.clientY - rect.top, rect.height - menuHeight - 4)),
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
  }

  const restartActive = (): void => {
    if (activeId === null) return
    setStatuses(previous => ({ ...previous, [activeId]: 'Restarting zsh...' }))
    setSessions(previous => previous.map(session => session.id === activeId
      ? { ...session, restart: session.restart + 1 }
      : session))
  }

  const activeStatus = activeId === null ? '' : statuses[activeId] ?? ''

  useEffect(() => {
    if (contextMenu === null) return
    const close = (event: MouseEvent): void => {
      if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return
      setContextMenu(null)
    }
    window.addEventListener('mousedown', close)
    return () => { window.removeEventListener('mousedown', close) }
  }, [contextMenu])

  useEffect(() => () => { resizeCleanupRef.current?.() }, [])

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
        onDoubleClick={() => { panelRef.current?.parentElement?.style.removeProperty('--dsh-terminal-height') }}
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
        <aside ref={railRef} className={css.sessionRail} aria-label="Terminal sessions" onScroll={() => { setContextMenu(null) }}>
          {sessions.map(session => (
            <div key={session.id} className={css.sessionRow} data-active={session.id === activeId ? 'true' : undefined} onContextMenu={event => { openContextMenu(event, session.id) }}>
              {editingId === session.id
                ? <div className={css.sessionEditor}><TerminalIcon /><input autoFocus value={renameDraft} aria-label={`Rename ${session.name}`} onChange={event => { setRenameDraft(event.target.value) }} onKeyDown={event => { handleRenameKey(event, session.id) }} onBlur={() => { commitRename(session.id) }} /></div>
                : <button type="button" className={css.sessionSelect} onClick={() => { setActiveId(session.id) }} title={statuses[session.id]}><TerminalIcon /><span>{session.name}</span></button>}
              <button type="button" className={css.sessionClose} aria-label={`Close ${session.name}`} title={`Close ${session.name}`} onClick={() => { closeSession(session.id) }}>×</button>
            </div>
          ))}
          {contextMenu !== null && (
            <div ref={contextMenuRef} className={css.contextMenu} role="menu" style={{ left: contextMenu.left, top: contextMenu.top }}>
              <button type="button" role="menuitem" onClick={() => { beginRename(contextMenu.id) }}>Rename</button>
              <button type="button" role="menuitem" onClick={() => { closeSession(contextMenu.id); setContextMenu(null) }}>Close</button>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
