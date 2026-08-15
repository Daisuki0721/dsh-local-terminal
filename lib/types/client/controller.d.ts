export interface TerminalControllerSnapshot {
    open: boolean;
    cwd?: string;
}
export declare class TerminalController {
    private snapshot;
    private readonly listeners;
    getSnapshot: () => TerminalControllerSnapshot;
    subscribe: (listener: () => void) => (() => void);
    show(cwd?: string): void;
    toggle(cwd?: string): void;
    hide(): void;
    private emit;
}
