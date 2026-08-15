import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { TerminalController } from './controller.ts'
import { mountHeroTerminalEntry } from './hero-entry.ts'
import { mountTerminalPanel } from './mount.tsx'
import { TerminalButton, type TerminalInjected } from './TerminalButton.tsx'

export const inject = ['slots', 'conversation']

export function apply(ctx: ClientContext): void {
  const controller = new TerminalController()
  const disposers = [mountTerminalPanel(controller), mountHeroTerminalEntry(controller)]
  ctx.inject(['slots', 'conversation'], (scope: ClientContext) => {
    scope.effect(() => scope.slots.register({
      name: 'conversation.session.header.actions',
      id: 'local-terminal',
      order: 60,
      inject: (): TerminalInjected => ({ terminalController: controller }),
    }, TerminalButton), 'dsh-local-terminal: header action')
  })
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-local-terminal: browser surfaces')
}
