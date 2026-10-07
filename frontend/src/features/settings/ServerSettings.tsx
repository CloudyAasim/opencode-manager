import { useMemo, useState } from 'react'
import { Check, History, Loader2, Server, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useI18n } from '@/lib/i18n'
import { normalizeServerUrl } from '@opencode-manager/shared/utils'
import {
  getStoredServerUrl,
  setStoredServerUrl,
  listRecentServerUrls,
} from '@/lib/server-selection'

/**
 * Which server this client talks to.
 *
 * The save has to reload the page, and that is not a workaround - it is what
 * the storage layer above documents. About a hundred and eighty call sites bake
 * `API_BASE_URL` into a module-level constant when their module is first
 * imported, so by the time this panel is on screen the old value is already
 * built into them. Swapping it in place would leave half the app talking to one
 * server and half to another; a reload rebuilds every constant from the new
 * choice, which is the only way the switch is actually complete.
 *
 * The panel therefore never claims the change took effect. It says the page will
 * reload, and the button does exactly that.
 */
export function ServerSettings() {
  const { t } = useI18n()

  // Captured once, deliberately: saving reloads the page rather than updating
  // this, so the value it compares against is the one the app booted with.
  const [current] = useState<string>(() => getStoredServerUrl() ?? '')
  const [draft, setDraft] = useState<string>(current)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // What the box will resolve to, shown as the person types. Normalizing here
  // rather than on save is what makes a pasted endpoint - which is what people
  // actually have on screen - look like the server it names before it is saved.
  const resolved = useMemo(() => normalizeServerUrl(draft), [draft])
  const recent = useMemo(() => listRecentServerUrls(), [])

  const dirty = resolved !== current
  const isSameOrigin = resolved === ''

  async function check(): Promise<void> {
    setChecking(true)
    setCheckError(null)
    try {
      // Absolute URL, and no credentials: this is a reachability probe, not a
      // session. A cross-origin probe answers or it does not; the session cookie
      // is the proxy's job, and asking for it here would fail for a reason that
      // has nothing to do with whether the server is there.
      const response = await fetch(`${resolved || ''}/api/health`, {
        method: 'GET',
        cache: 'no-store',
      })
      if (!response.ok) {
        setCheckError(t('settingsPanels.connection.checkFailedStatus', { status: response.status }))
        return
      }
      const body = await response.json() as { status?: string }
      if (body.status !== 'healthy') {
        setCheckError(t('settingsPanels.connection.checkUnhealthy', { status: body.status ?? 'unknown' }))
        return
      }
      setCheckError(null)
    } catch {
      setCheckError(t('settingsPanels.connection.checkUnreachable'))
    } finally {
      setChecking(false)
    }
  }

  function apply(): void {
    setStoredServerUrl(resolved)
    // The constants are already built; only a reload rebuilds them.
    window.location.reload()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          {t('settingsPanels.connection.title')}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('settingsPanels.connection.description')}
        </p>
      </div>

      <div className="space-y-3">
        <Label htmlFor="server-url">{t('settingsPanels.connection.label')}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="server-url"
            value={draft}
            placeholder={t('settingsPanels.connection.placeholder')}
            onChange={(event) => { setDraft(event.target.value); setSaved(false); setCheckError(null) }}
            onKeyDown={(event) => { if (event.key === 'Enter' && dirty) apply() }}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="button" variant="outline" onClick={check} disabled={checking}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
            {t('settingsPanels.connection.check')}
          </Button>
        </div>

        {/* The resolved form, not the typed one: a whole endpoint typed into the
            box has to be shown reducing to its server, or the person cannot tell
            whether the trailing path survived. */}
        <p className="text-xs text-muted-foreground font-mono break-all">
          {isSameOrigin
            ? t('settingsPanels.connection.resolvesToSameOrigin')
            : t('settingsPanels.connection.resolvesTo', { url: resolved })}
        </p>

        {checkError && (
          <Alert variant="destructive">
            <AlertDescription>{checkError}</AlertDescription>
          </Alert>
        )}

        {saved && (
          <Alert>
            <AlertDescription>{t('settingsPanels.connection.saved')}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={apply} disabled={!dirty}>
          <Check className="h-4 w-4" />
          {t('settingsPanels.connection.save')}
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => { setDraft(current); setSaved(false); setCheckError(null) }}
          >
            <X className="h-4 w-4" />
            {t('common.cancel')}
          </Button>
        )}
      </div>

      {/* The stated reason for being able to choose a server is that it changes,
          so the ones used before are the point of this list, not a nicety. */}
      {recent.length > 0 && (
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-muted-foreground">
            <History className="h-3.5 w-3.5" />
            {t('settingsPanels.connection.recent')}
          </Label>
          <div className="flex flex-wrap gap-2">
            {recent.map((url) => (
              <Button
                key={url}
                variant="outline"
                size="sm"
                className="font-mono"
                onClick={() => { setDraft(url); setSaved(false); setCheckError(null) }}
              >
                {url.replace(/^https?:\/\//, '')}
              </Button>
            ))}
          </div>
        </div>
      )}

      <Alert>
        <AlertDescription>{t('settingsPanels.connection.reloadNotice')}</AlertDescription>
      </Alert>
    </div>
  )
}