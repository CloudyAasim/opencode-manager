import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Loader2, PlugZap } from 'lucide-react'
import { terminalApi } from '@/api/terminal'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type TerminalStatus = 'connecting' | 'ready' | 'closed' | 'error'

const INPUT_FLUSH_MS = 10
const RESIZE_DEBOUNCE_MS = 150
const RECONNECT_DELAY_MS = 1200

function createTheme() {
  const isDark = typeof document !== 'undefined'
    ? document.documentElement.classList.contains('dark')
    : true
  return isDark
    ? {
        background: '#0a0a0a',
        foreground: '#e5e7eb',
        cursor: '#e5e7eb',
        selectionBackground: '#334155',
        black: '#1f2937',
        brightBlack: '#4b5563',
      }
    : {
        background: '#ffffff',
        foreground: '#111827',
        cursor: '#111827',
        selectionBackground: '#bfdbfe',
        black: '#111827',
        brightBlack: '#6b7280',
      }
}

export function TerminalView({ className, cwd }: { className?: string; cwd?: string }) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const lastSeqRef = useRef(0)
  const pendingInputRef = useRef('')
  const inputTimerRef = useRef<number | null>(null)
  const resizeTimerRef = useRef<number | null>(null)
  const lastDimensionsRef = useRef<{ cols: number; rows: number } | null>(null)
  const disposedRef = useRef(false)
  const tRef = useRef(t)
  tRef.current = t

  const [status, setStatus] = useState<TerminalStatus>('connecting')
  const [exitInfo, setExitInfo] = useState<{ code: number | null; reason: string } | null>(null)
  const [sessionCwd, setSessionCwd] = useState<string | null>(null)
  const [restartKey, setRestartKey] = useState(0)

  const writeNotice = useCallback((message: string) => {
    termRef.current?.write(`\r\n\x1b[90m[${message}]\x1b[0m\r\n`)
  }, [])

  useEffect(() => {
    disposedRef.current = false
    const container = containerRef.current
    if (!container) return

    setStatus('connecting')
    setExitInfo(null)
    setSessionCwd(null)
    lastSeqRef.current = 0

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      scrollback: 5000,
      theme: createTheme(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    try {
      fit.fit()
    } catch {
      // container not measurable yet
    }
    termRef.current = term
    fitRef.current = fit

    const flushInput = () => {
      inputTimerRef.current = null
      const chunk = pendingInputRef.current
      pendingInputRef.current = ''
      const sessionId = sessionIdRef.current
      if (!chunk || !sessionId) return
      void terminalApi.sendInput(sessionId, chunk).catch(() => {})
    }

    const queueInput = (data: string) => {
      pendingInputRef.current += data
      if (inputTimerRef.current == null) {
        inputTimerRef.current = window.setTimeout(flushInput, INPUT_FLUSH_MS)
      }
    }

    const dataDisposable = term.onData(queueInput)

    const scheduleResize = (cols: number, rows: number) => {
      const previous = lastDimensionsRef.current
      if (previous && previous.cols === cols && previous.rows === rows) return
      lastDimensionsRef.current = { cols, rows }
      if (resizeTimerRef.current != null) window.clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null
        const sessionId = sessionIdRef.current
        if (sessionId) void terminalApi.resize(sessionId, cols, rows).catch(() => {})
      }, RESIZE_DEBOUNCE_MS)
    }

    const handleContainerResize = () => {
      try {
        fit.fit()
      } catch {
        return
      }
      const { cols, rows } = term
      if (cols > 0 && rows > 0) scheduleResize(cols, rows)
    }

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleContainerResize) : null
    observer?.observe(container)

    let reconnectTimer: number | null = null
    let sessionClosed = false

    const connectStream = (sessionId: string) => {
      if (disposedRef.current || sessionClosed) return
      const source = new EventSource(terminalApi.streamUrl(sessionId, lastSeqRef.current), { withCredentials: true })
      eventSourceRef.current = source

      source.addEventListener('ready', (event) => {
        try {
          const ready = JSON.parse((event as MessageEvent).data) as { session?: { cwd?: string } }
          if (ready.session?.cwd) setSessionCwd(ready.session.cwd)
        } catch {
          // ignore malformed ready payload
        }
        setStatus('ready')
      })

      source.addEventListener('output', (event) => {
        try {
          const chunk = JSON.parse((event as MessageEvent).data) as { seq: number; data: string }
          if (chunk.seq > lastSeqRef.current) lastSeqRef.current = chunk.seq
          term.write(chunk.data)
        } catch {
          // ignore malformed frames
        }
      })

      source.addEventListener('exit', (event) => {
        sessionClosed = true
        source.close()
        eventSourceRef.current = null
        let info: { code: number | null; reason: string } = { code: null, reason: 'closed' }
        try {
          info = JSON.parse((event as MessageEvent).data) as { code: number | null; reason: string }
        } catch {
          // keep defaults
        }
        setExitInfo(info)
        setStatus('closed')
        writeNotice(`${tRef.current('terminal.exited')} (${tRef.current('terminal.exitCode')}: ${info.code ?? '-'} · ${info.reason})`)
      })

      source.onerror = () => {
        source.close()
        eventSourceRef.current = null
        if (disposedRef.current || sessionClosed) return
        setStatus('connecting')
        reconnectTimer = window.setTimeout(() => connectStream(sessionId), RECONNECT_DELAY_MS)
      }
    }

    const start = async () => {
      try {
        const session = await terminalApi.createSession({ cols: term.cols || 120, rows: term.rows || 30, ...(cwd ? { cwd } : {}) })
        if (disposedRef.current) {
          void terminalApi.close(session.id).catch(() => {})
          return
        }
        sessionIdRef.current = session.id
        lastDimensionsRef.current = { cols: session.cols, rows: session.rows }
        connectStream(session.id)
      } catch (error) {
        setStatus('error')
        const message = error instanceof Error ? error.message : 'error'
        writeNotice(message)
      }
    }

    void start()

    return () => {
      disposedRef.current = true
      dataDisposable.dispose()
      observer?.disconnect()
      if (inputTimerRef.current != null) window.clearTimeout(inputTimerRef.current)
      if (resizeTimerRef.current != null) window.clearTimeout(resizeTimerRef.current)
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer)
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      const sessionId = sessionIdRef.current
      sessionIdRef.current = null
      if (sessionId) void terminalApi.close(sessionId).catch(() => {})
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [restartKey, writeNotice, cwd])

  const handleReconnect = () => {
    setRestartKey((key) => key + 1)
  }

  const statusLabel = status === 'ready'
    ? t('terminal.connected')
    : status === 'closed'
      ? t('terminal.disconnected')
      : status === 'error'
        ? t('terminal.unavailableTitle')
        : t('terminal.connecting')

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              status === 'ready' ? 'bg-green-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-muted-foreground',
            )}
          />
          <span>{statusLabel}</span>
          {sessionCwd && (
            <span className="hidden truncate font-mono sm:inline">
              · {t('terminal.workingDirectory')}: {sessionCwd}
            </span>
          )}
          {exitInfo && (
            <span className="truncate">
              · {t('terminal.exitCode')}: {exitInfo.code ?? '-'} ({exitInfo.reason})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status === 'connecting' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Button variant="outline" size="sm" className="h-8" onClick={handleReconnect}>
            <PlugZap className="mr-2 h-3.5 w-3.5" />
            {t('terminal.reconnect')}
          </Button>
        </div>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden bg-background p-2" />
    </div>
  )
}
