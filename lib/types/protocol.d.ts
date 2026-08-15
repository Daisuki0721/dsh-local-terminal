export declare const LOCAL_TERMINAL_PATH: "/api/dsh-local-terminal/pty";
export type TerminalClientFrame = {
    type: 'input';
    data: string;
} | {
    type: 'resize';
    cols: number;
    rows: number;
};
export type TerminalServerFrame = {
    type: 'ready';
    cwd: string;
    shell: string;
} | {
    type: 'output';
    data: string;
} | {
    type: 'exit';
    code: number | null;
    signal?: number;
    error?: string;
};
