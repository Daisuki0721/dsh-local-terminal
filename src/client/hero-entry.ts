import type { TerminalController } from './controller.ts'
import css from './terminal.module.css'

/**
 * The hero view has no registered slot for a companion button (the preset
 * slot is `kind: 'single'` and cannot host another entry), so the Terminal
 * trigger rides the hero's workspace row through stable data attributes:
 * `[data-phase='hero']` roots the phase and the hero composer's previous
 * sibling is the workspace row that ends with the agent preset slot.
 */
const HERO_PHASE = '[data-phase="hero"]'
const HERO_COMPOSER = '[data-composer-card]'
const SELF_HEAL_INTERVAL_MS = 4000

export function mountHeroTerminalEntry(controller: TerminalController): () => void {
  const host = document.createElement('span')
  host.dataset.dshLocalTerminalHero = ''
  host.className = css.heroHost
  const button = document.createElement('button')
  button.type = 'button'
  button.className = css.trigger
  button.title = 'Open local zsh terminal'
  button.setAttribute('aria-label', 'Open local zsh terminal')
  button.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2"></rect><path d="m4.25 5.5 2.25 2-2.25 2M8.5 9.5h3"></path></svg><span>Terminal</span>'
  button.addEventListener('click', () => { controller.toggle() })
  host.append(button)

  const place = (): void => {
    const phase = document.querySelector<HTMLElement>(HERO_PHASE)
    if (phase === null || !phase.isConnected) {
      if (host.isConnected) host.remove()
      return
    }
    const composer = phase.querySelector<HTMLElement>(HERO_COMPOSER)
    const row = composer?.previousElementSibling
    if (row instanceof HTMLElement) {
      if (host.parentElement !== row) row.append(host)
    } else if (host.isConnected) {
      host.remove()
    }
  }
  const observer = new MutationObserver(place)
  observer.observe(document.body, { childList: true, subtree: true })
  const unsubscribe = controller.subscribe(() => {
    if (controller.getSnapshot().open) button.dataset.active = 'true'
    else delete button.dataset.active
    button.setAttribute('aria-pressed', String(controller.getSnapshot().open))
  })
  place()
  const selfHeal = window.setInterval(place, SELF_HEAL_INTERVAL_MS)
  return () => {
    window.clearInterval(selfHeal)
    observer.disconnect()
    unsubscribe()
    host.remove()
  }
}
