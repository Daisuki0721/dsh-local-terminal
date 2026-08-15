import { useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TerminalController } from './controller.ts'
import css from './terminal.module.css'

export interface TerminalInjected {
  terminalController: TerminalController
}

export type TerminalButtonProps = PropsRuntime<'conversation.session.header.actions'> & TerminalInjected

export function TerminalIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" />
      <path d="m4.25 5.5 2.25 2-2.25 2M8.5 9.5h3" />
    </svg>
  )
}

export function TerminalButton(props: TerminalButtonProps) {
  const snapshot = useSyncExternalStore(props.terminalController.subscribe, props.terminalController.getSnapshot)
  const cwd = props.useSessions(state => state.byId[props.sessionId]?.cwd)
  return (
    <button
      type="button"
      className={css.trigger}
      data-active={snapshot.open ? 'true' : undefined}
      aria-pressed={snapshot.open}
      title="Open local zsh terminal"
      onClick={() => { props.terminalController.toggle(cwd) }}
    >
      <TerminalIcon />
      <span>Terminal</span>
    </button>
  )
}
