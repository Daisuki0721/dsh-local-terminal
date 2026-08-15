import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { makeTerminalUpgrade } from './routes.ts'
import type { LocalPtySession } from './pty-session.ts'

export const name = 'local-terminal'
export const inject = ['webServer']

export function apply(ctx: Context): void {
  const sessions = new Set<LocalPtySession>()
  const upgrade = makeTerminalUpgrade((session) => {
    sessions.add(session)
    return () => { sessions.delete(session) }
  })
  ctx.effect(() => ctx.webServer.registerUpgrade(upgrade), 'dsh-local-terminal: websocket route')
  ctx.effect(() => () => {
    for (const session of sessions) session.close()
    sessions.clear()
  }, 'dsh-local-terminal: pty sessions')
}
