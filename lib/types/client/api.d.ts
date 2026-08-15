export interface LocalTerminalConnection {
    onReady?: (cwd: string, shell: string) => void;
    onOutput?: (data: string) => void;
    onExit?: (code: number | null, error?: string) => void;
    send(data: string): void;
    resize(cols: number, rows: number): void;
    close(): void;
}
export declare function openTerminal(cwd: string | undefined, cols: number, rows: number): LocalTerminalConnection;
