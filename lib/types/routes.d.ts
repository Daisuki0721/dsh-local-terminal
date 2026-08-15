import type { IncomingMessage } from 'node:http';
import type { WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver';
import { type LocalPtySession } from './pty-session.ts';
export declare function isLoopbackRequest(request: IncomingMessage): boolean;
export declare function makeTerminalUpgrade(onSession?: (session: LocalPtySession) => () => void): WebUpgradeRoute;
