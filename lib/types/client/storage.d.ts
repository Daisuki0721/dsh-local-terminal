export interface PersistedSession {
    id: number;
    sessionId?: string;
    name: string;
    cwd?: string;
}
export interface PersistedTerminalState {
    open: boolean;
    height?: string;
    railWidth?: string;
    split?: {
        leftId: number;
        rightId: number;
    } | null;
    splitRatio?: string;
    activeId: number | null;
    sessions: PersistedSession[];
}
export declare function loadTerminalState(): PersistedTerminalState;
export declare function saveTerminalState(state: PersistedTerminalState): void;
