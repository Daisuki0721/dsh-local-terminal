export interface PersistedSession {
    id: number;
    name: string;
    cwd?: string;
}
export interface PersistedTerminalState {
    open: boolean;
    height?: string;
    railWidth?: string;
    activeId: number | null;
    sessions: PersistedSession[];
}
export declare function loadTerminalState(): PersistedTerminalState;
export declare function saveTerminalState(state: PersistedTerminalState): void;
