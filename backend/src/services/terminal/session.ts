import type { PtyProcess } from './pty'

export interface TerminalOutputChunk {
  seq: number
  data: string
}

export interface TerminalExit {
  code: number | null
  reason: string
}

export interface TerminalSubscriber {
  onOutput: (chunk: TerminalOutputChunk) => void
  onExit: (exit: TerminalExit) => void
}

export interface TerminalSessionOptions {
  id: string
  userId: string
  userEmail: string
  ipAddress: string | null
  userAgent: string | null
  shell: string
  cwd: string
  cols: number
  rows: number
  maxBufferBytes?: number
}

const DEFAULT_MAX_BUFFER_BYTES = 256 * 1024
const MAX_BUFFER_CHUNKS = 4000

export class TerminalSession {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly ipAddress: string | null
  readonly userAgent: string | null
  readonly shell: string
  readonly cwd: string
  readonly createdAt: number

  private readonly pty: PtyProcess
  private readonly maxBufferBytes: number
  private readonly subscribers = new Set<TerminalSubscriber>()
  private readonly exitListeners = new Set<(exit: TerminalExit) => void>()
  private readonly detachData: () => void
  private readonly detachExit: () => void

  private cols: number
  private rows: number
  private seq = 0
  private buffer: TerminalOutputChunk[] = []
  private bufferBytes = 0
  private totalBytes = 0
  private exited = false
  private exitCode: number | null = null
  private closeReason = ''
  private lastActivityAtValue: number

  constructor(options: TerminalSessionOptions, pty: PtyProcess) {
    this.id = options.id
    this.userId = options.userId
    this.userEmail = options.userEmail
    this.ipAddress = options.ipAddress
    this.userAgent = options.userAgent
    this.shell = options.shell
    this.cwd = options.cwd
    this.cols = options.cols
    this.rows = options.rows
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
    this.createdAt = Date.now()
    this.lastActivityAtValue = this.createdAt
    this.pty = pty

    this.detachData = pty.onData((data) => this.handleData(data))
    this.detachExit = pty.onExit((code) => this.handleExit(code))
  }

  get lastActivityAt(): number {
    return this.lastActivityAtValue
  }

  get isExited(): boolean {
    return this.exited
  }

  get dimensions(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows }
  }

  get stats(): { seq: number; totalBytes: number } {
    return { seq: this.seq, totalBytes: this.totalBytes }
  }

  get exit(): TerminalExit {
    return { code: this.exitCode, reason: this.closeReason }
  }

  onExit(listener: (exit: TerminalExit) => void): () => void {
    if (this.exited) {
      queueMicrotask(() => listener(this.exit))
      return () => {}
    }
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  write(data: string): void {
    if (this.exited) return
    this.lastActivityAtValue = Date.now()
    this.pty.write(data)
  }

  resize(cols: number, rows: number): void {
    if (this.exited) return
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return
    this.cols = Math.min(Math.floor(cols), 1000)
    this.rows = Math.min(Math.floor(rows), 1000)
    this.lastActivityAtValue = Date.now()
    this.pty.resize(this.cols, this.rows)
  }

  attach(subscriber: TerminalSubscriber, fromSeq = 0): () => void {
    this.subscribers.add(subscriber)

    for (const chunk of this.buffer) {
      if (chunk.seq > fromSeq) subscriber.onOutput(chunk)
    }

    if (this.exited) {
      queueMicrotask(() => subscriber.onExit({ code: this.exitCode, reason: this.closeReason }))
    }

    return () => {
      this.subscribers.delete(subscriber)
    }
  }

  close(reason: string): void {
    if (this.exited) return
    this.closeReason = reason
    this.pty.kill()
  }

  dispose(): void {
    this.detachData()
    this.detachExit()
    this.subscribers.clear()
    this.exitListeners.clear()
    this.buffer = []
    this.bufferBytes = 0
    if (!this.exited) {
      this.closeReason = 'disposed'
      this.pty.kill()
    }
    this.exited = true
  }

  private handleData(data: string): void {
    this.lastActivityAtValue = Date.now()
    this.totalBytes += data.length
    const chunk: TerminalOutputChunk = { seq: ++this.seq, data }
    this.buffer.push(chunk)
    this.bufferBytes += data.length
    this.trimBuffer()

    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber.onOutput(chunk)
      } catch {
        this.subscribers.delete(subscriber)
      }
    }
  }

  private handleExit(code: number | null): void {
    if (this.exited) return
    this.exited = true
    this.exitCode = code
    if (!this.closeReason) this.closeReason = 'process-exited'
    const exit: TerminalExit = { code, reason: this.closeReason }
    for (const listener of [...this.exitListeners]) {
      try {
        listener(exit)
      } catch {
      void 0
      }
    }
    this.exitListeners.clear()
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber.onExit(exit)
      } catch {
        this.subscribers.delete(subscriber)
      }
    }
    this.subscribers.clear()
  }

  private trimBuffer(): void {
    while (
      this.buffer.length > 1 &&
      (this.bufferBytes > this.maxBufferBytes || this.buffer.length > MAX_BUFFER_CHUNKS)
    ) {
      const removed = this.buffer.shift()
      if (!removed) break
      this.bufferBytes -= removed.data.length
    }
  }
}
