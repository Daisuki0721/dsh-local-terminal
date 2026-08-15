import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { TerminalController } from './controller.ts';
export interface TerminalInjected {
    terminalController: TerminalController;
}
export type TerminalButtonProps = PropsRuntime<'conversation.session.header.actions'> & TerminalInjected;
export declare function TerminalIcon(): import("react").JSX.Element;
export declare function TerminalButton(props: TerminalButtonProps): import("react").JSX.Element;
