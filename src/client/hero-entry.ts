import type { TerminalController } from './controller.ts'
import css from './terminal.module.css'

const PRESET_SLOT = '[data-slot="conversation.hero.agentPreset"]'

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
    const slot = document.querySelector<HTMLElement>(PRESET_SLOT)
    if (slot === null || !slot.isConnected) return
    if (host.previousElementSibling !== slot) slot.insertAdjacentElement('afterend', host)
  }
  const observer = new MutationObserver(place)
  observer.observe(document.body, { childList: true, subtree: true })
  const unsubscribe = controller.subscribe(() => {
    if (controller.getSnapshot().open) button.dataset.active = 'true'
    else delete button.dataset.active
    button.setAttribute('aria-pressed', String(controller.getSnapshot().open))
  })
  place()
  return () => {
    observer.disconnect()
    unsubscribe()
    host.remove()
  }
}
