import type { IncomingMessage } from 'node:http';
import type { WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver';
export declare function isLoopbackRequest(request: IncomingMessage): boolean;
export declare function makeTerminalUpgrade(): {
    upgrade: WebUpgradeRoute;
    dispose: () => void;
};
