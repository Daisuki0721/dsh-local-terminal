export interface TerminalControllerSnapshot {
  open: boolean
  cwd?: string
}

export class TerminalController {
  private snapshot: TerminalControllerSnapshot = { open: false }
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): TerminalControllerSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  show(cwd?: string): void {
    this.snapshot = { ...this.snapshot, open: true, cwd: cwd ?? this.snapshot.cwd }
    this.emit()
  }

  toggle(cwd?: string): void {
    this.snapshot = { ...this.snapshot, open: !this.snapshot.open, cwd: cwd ?? this.snapshot.cwd }
    this.emit()
  }

  hide(): void {
    if (!this.snapshot.open) return
    this.snapshot = { ...this.snapshot, open: false }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
