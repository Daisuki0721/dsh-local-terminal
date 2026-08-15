import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { makeTerminalUpgrade } from './routes.ts'

export const name = 'local-terminal'
export const inject = ['webServer']

export function apply(ctx: Context): void {
  const { upgrade, dispose } = makeTerminalUpgrade()
  ctx.effect(() => ctx.webServer.registerUpgrade(upgrade), 'dsh-local-terminal: websocket route')
  ctx.effect(() => dispose, 'dsh-local-terminal: pty sessions')
}
