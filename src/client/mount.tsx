import { createRoot } from 'react-dom/client'
import type { TerminalController } from './controller.ts'
import { TerminalPanel } from './TerminalPanel.tsx'
import css from './terminal.module.css'

const CONVERSATION_SLOT = '[data-slot="conversation"]'
const SESSION_SLOT = '[data-slot="conversation.session"]'

export function mountTerminalPanel(controller: TerminalController): () => void {
  const host = document.createElement('div')
  host.dataset.dshLocalTerminalRoot = ''
  host.className = css.mount
  document.body.append(host)
  const root = createRoot(host)
  root.render(<TerminalPanel controller={controller} />)

  let reflowFrame: number | undefined
  let settleTimer: number | undefined
  const emitConversationReflow = (): void => {
    const conversation = document.querySelector<HTMLElement>(CONVERSATION_SLOT)
    conversation?.firstElementChild?.getBoundingClientRect()
    window.dispatchEvent(new Event('resize'))
    const session = document.querySelector<HTMLElement>(SESSION_SLOT)
    session?.dispatchEvent(new Event('scroll', { bubbles: true }))
    session?.parentElement?.dispatchEvent(new Event('scroll', { bubbles: true }))
  }
  const scheduleConversationReflow = (): void => {
    if (reflowFrame === undefined) {
      reflowFrame = requestAnimationFrame(() => {
        reflowFrame = undefined
        emitConversationReflow()
      })
    }
    if (settleTimer !== undefined) window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(emitConversationReflow, 90)
  }

  const place = (): void => {
    const slot = document.querySelector<HTMLElement>(CONVERSATION_SLOT)
    const layout = slot?.firstElementChild
    if (!(layout instanceof HTMLElement)) return
    if (host.parentElement !== layout) layout.append(host)
  }
  const observer = new MutationObserver(place)
  observer.observe(document.body, { childList: true, subtree: true })
  const resizeObserver = new ResizeObserver(scheduleConversationReflow)
  resizeObserver.observe(host)
  host.addEventListener('transitionend', scheduleConversationReflow)
  const unsubscribe = controller.subscribe(() => {
    if (controller.getSnapshot().open) host.dataset.open = 'true'
    else delete host.dataset.open
    place()
  })
  place()

  const onToggleKey = (event: KeyboardEvent): void => {
    if (event.code !== 'Backquote' || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return
    const target = event.target
    if (target instanceof HTMLElement) {
      const editable = target.closest('input, textarea, [contenteditable="true"]')
      if (editable !== null && editable.closest('[data-dsh-local-terminal-root]') === null) return
    }
    event.preventDefault()
    controller.toggle()
  }
  window.addEventListener('keydown', onToggleKey)

  return () => {
    window.removeEventListener('keydown', onToggleKey)
    observer.disconnect()
    resizeObserver.disconnect()
    host.removeEventListener('transitionend', scheduleConversationReflow)
    if (reflowFrame !== undefined) cancelAnimationFrame(reflowFrame)
    if (settleTimer !== undefined) window.clearTimeout(settleTimer)
    unsubscribe()
    root.unmount()
    host.remove()
  }
}
