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
    railSide?: 'left' | 'right';
    railVisible?: boolean;
    /** Sidebar units; each unit holds 1..6 pane member ids sharing one name. */
    groups?: number[][];
    splitRatio?: string;
    activeId: number | null;
    sessions: PersistedSession[];
}
export declare function loadTerminalState(): PersistedTerminalState;
export declare function saveTerminalState(state: PersistedTerminalState): void;
