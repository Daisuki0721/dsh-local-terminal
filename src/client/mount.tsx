import { createRoot } from 'react-dom/client'
import type { TerminalController } from './controller.ts'
import { TerminalPanel } from './TerminalPanel.tsx'
import css from './terminal.module.css'

/**
 * The app does not expose a bottom-dock slot, so the panel docks below the
 * conversation column through its stable data attributes. `place()` is
 * idempotent and re-runs on DOM changes plus a slow self-heal interval, so a
 * remount of the conversation tree can never strand the panel on <body>.
 */
const SCROLL_BODY = '[data-conversation-scroll]'
const SESSION_SLOT = '[data-slot="conversation.session"]'
const SELF_HEAL_INTERVAL_MS = 4000

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
    const scroll = document.querySelector<HTMLElement>(SCROLL_BODY)
    scroll?.getBoundingClientRect()
    window.dispatchEvent(new Event('resize'))
    scroll?.dispatchEvent(new Event('scroll', { bubbles: true }))
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

  const findDockAnchor = (): HTMLElement | null => {
    const scroll = document.querySelector<HTMLElement>(SCROLL_BODY)
    const column = scroll?.parentElement
    if (column instanceof HTMLElement) return column
    // Fallback for layouts without the scroll body: climb from the session slot.
    const session = document.querySelector<HTMLElement>(SESSION_SLOT)
    const climbed = session?.parentElement?.parentElement
    if (climbed instanceof HTMLElement) return climbed
    return null
  }

  const place = (): void => {
    const anchor = findDockAnchor()
    if (anchor === null) return
    if (host.parentElement !== anchor) anchor.append(host)
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
  const selfHeal = window.setInterval(place, SELF_HEAL_INTERVAL_MS)

  return () => {
    window.clearInterval(selfHeal)
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
