import type { PtyProcess, PtySpawnOptions, PtySpawner } from '../../src/services/terminal/pty'

export class FakePtyProcess implements PtyProcess {
  written: string[] = []
  resizes: Array<{ cols: number; rows: number }> = []
  killed = false

  private readonly dataListeners = new Set<(chunk: string) => void>()
  private readonly exitListeners = new Set<(code: number | null) => void>()

  write(data: string): void {
    this.written.push(data)
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows })
  }

  kill(): void {
    if (this.killed) return
    this.killed = true
    this.emitExit(0)
  }

  onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onExit(listener: (code: number | null) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data)
  }

  emitExit(code: number | null): void {
    for (const listener of this.exitListeners) listener(code)
    this.exitListeners.clear()
  }
}

export class FakePtySpawner implements PtySpawner {
  readonly processes: FakePtyProcess[] = []
  readonly spawnOptions: PtySpawnOptions[] = []

  available(): boolean {
    return true
  }

  spawn(options: PtySpawnOptions): FakePtyProcess {
    const process = new FakePtyProcess()
    this.processes.push(process)
    this.spawnOptions.push(options)
    return process
  }
}
