import { useEffect, useMemo, useState } from 'react'
import { Check, History, Loader2, Server, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SectionHeader } from '@/components/ui/section-header'
import { useI18n } from '@/lib/i18n'
import { normalizeServerUrl } from '@opencode-manager/shared/utils'
import {
  getStoredServerUrl,
  setStoredServerUrl,
  listRecentServerUrls,
} from '@/lib/server-selection'
import { readProxyTarget, writeProxyTarget, type ProxyTarget } from '@/lib/proxy-target'

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
 *
 * **Inside a desktop client the address means something different.** The client
 * serves this page itself and forwards the requests to the server, so that the
 * browser sees one origin and the session cookie travels. The address is then
 * the proxy's target, not the origin this page sends its requests to - writing
 * it into the page's own storage would point the page at a remote origin and
 * undo the one thing the proxy is there for. So in that case the address goes
 * to the proxy, which keeps it and re-points itself.
 */
export function ServerSettings() {
  const { t } = useI18n()

  // Captured once, deliberately: saving reloads the page rather than updating
  // this, so the value it compares against is the one the app booted with.
  const [stored] = useState<string>(() => getStoredServerUrl() ?? '')
  const [draft, setDraft] = useState<string | null>(null)
  const [proxyTarget, setProxyTarget] = useState<ProxyTarget | null>(null)
  const [probing, setProbing] = useState(true)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Whether this page is behind a client proxy, and where it points. A plain
  // web deployment answers the probe with something that is not a proxy, and
  // then the address belongs to the page's own storage, as it always did.
  useEffect(() => {
    let cancelled = false
    void readProxyTarget().then((found) => {
      if (cancelled) return
      setProxyTarget(found)
      setProbing(false)
    })
    return () => { cancelled = true }
  }, [])

  const behindProxy = proxyTarget !== null
  const current = behindProxy ? (proxyTarget?.target ?? '') : stored
  const value = draft ?? current

  // What the box will resolve to, shown as the person types. Normalizing here
  // rather than on save is what makes a pasted endpoint - which is what people
  // actually have on screen - look like the server it names before it is saved.
  const resolved = useMemo(() => normalizeServerUrl(value), [value])
  const recent = useMemo(() => listRecentServerUrls(), [])

  const dirty = resolved !== current
  // A proxy needs somewhere to point. On the web, an empty address is a
  // choice - "the server that served this page" - and there is no such thing
  // here: the proxy is the page's server and the target is a different one.
  const isSameOrigin = resolved === '' && !behindProxy
  const canSave = dirty && (!behindProxy || resolved !== '')

  async function check(): Promise<void> {
    setChecking(true)
    setCheckError(null)
    try {
      // Absolute URL, and no credentials: this is a reachability probe, not a
      // session. A cross-origin probe answers or it does not; the session cookie
      // is the proxy's job, and asking for it here would fail for a reason that
      // has nothing to do with whether the server is there.
      //
      // Behind a proxy the address in the box is not the one being talked to
      // until it is saved, so what is checked is the server the proxy is
      // pointed at now - which is the one this page is actually using.
      const url = behindProxy ? '/api/health' : `${resolved || ''}/api/health`
      const response = await fetch(url, {
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

  async function apply(): Promise<void> {
    if (behindProxy) {
      setSaving(true)
      setCheckError(null)
      const result = await writeProxyTarget(resolved)
      setSaving(false)
      if (!result.ok) {
        setCheckError(result.error ?? t('settingsPanels.connection.checkUnreachable'))
        return
      }
      // The session in this window belongs to the server the proxy used to
      // point at. It has to start again rather than keep one nobody can use.
      window.location.reload()
      return
    }

    setStoredServerUrl(resolved)
    // The constants are already built; only a reload rebuilds them.
    window.location.reload()
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t('settingsPanels.connection.title')}
        description={t('settingsPanels.connection.description')}
      />

      {behindProxy && (
        <Alert>
          <AlertDescription>{t('settingsPanels.connection.proxyNotice')}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        <Label htmlFor="server-url">{t('settingsPanels.connection.label')}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="server-url"
            value={value}
            placeholder={t('settingsPanels.connection.placeholder')}
            onChange={(event) => { setDraft(event.target.value); setSaved(false); setCheckError(null) }}
            onKeyDown={(event) => { if (event.key === 'Enter' && canSave) void apply() }}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="button" variant="outline" onClick={check} disabled={checking || probing}>
            {checking ? <Loader2 className="size-4 animate-spin" /> : <Server className="size-4" />}
            {t('settingsPanels.connection.check')}
          </Button>
        </div>

        {/* The resolved form, not the typed one: a whole endpoint typed into the
            box has to be shown reducing to its server, or the person cannot tell
            whether the trailing path survived. */}
        {!isSameOrigin && (
          <p className="text-xs text-muted-foreground font-mono break-all">
            {t('settingsPanels.connection.resolvesTo', { url: resolved })}
          </p>
        )}
        {isSameOrigin && (
          <p className="text-xs text-muted-foreground font-mono break-all">
            {t('settingsPanels.connection.resolvesToSameOrigin')}
          </p>
        )}

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
        <Button onClick={() => void apply()} disabled={!canSave || saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t('settingsPanels.connection.save')}
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => { setDraft(null); setSaved(false); setCheckError(null) }}
          >
            <X className="size-4" />
            {t('common.cancel')}
          </Button>
        )}
      </div>

      {/* The stated reason for being able to choose a server is that it changes,
          so the ones used before are the point of this list, not a nicety. */}
      {recent.length > 0 && (
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <History className="size-3.5" />
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
