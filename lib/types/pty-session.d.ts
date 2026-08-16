export interface LocalPtySession {
    readonly cwd: string;
    readonly shell: string;
    readonly exitState: {
        exitCode: number;
        signal?: number;
    } | null;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    close(): void;
    onData(listener: (data: string) => void): {
        dispose(): void;
    };
    onExit(listener: (event: {
        exitCode: number;
        signal?: number;
    }) => void): {
        dispose(): void;
    };
}
export declare function clampTerminalSize(cols: number, rows: number): {
    cols: number;
    rows: number;
};
export declare function resolveTerminalCwd(candidate?: string): string;
/**
 * node-pty 1.1.0's macOS prebuild can arrive without the executable bit on
 * spawn-helper when restored through a content-addressed package store.
 * Repair only that package-owned helper before the native fork call.
 */
export declare function ensureSpawnHelperExecutable(): void;
export interface ResolvedShell {
    shell: string;
    args: string[];
}
export declare function resolveShell(): ResolvedShell;
export declare function openLocalPty(options: {
    cwd?: string;
    cols: number;
    rows: number;
}): LocalPtySession;
