import { useState, useEffect } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Loader2, Plus, Trash2, Save } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { TTSSettings } from './TTSSettings'
import { showToast } from '@/lib/toast'
import type { GitCredential } from '@/api/types/settings'

export function GeneralSettings() {
  const { preferences, isLoading, updateSettings, updateSettingsAsync, isUpdating } = useSettings()
  const [gitCredentials, setGitCredentials] = useState<GitCredential[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    if (preferences) {
      setGitCredentials(preferences.gitCredentials || [])
      setHasChanges(false)
    }
  }, [preferences])

  const checkForChanges = (newCredentials: GitCredential[]) => {
    const currentCreds = JSON.stringify(preferences?.gitCredentials || [])
    const newCreds = JSON.stringify(newCredentials)
    setHasChanges(currentCreds !== newCreds)
  }

  const addCredential = () => {
    const newCredentials = [...gitCredentials, { name: '', host: '', token: '', username: '' }]
    setGitCredentials(newCredentials)
    checkForChanges(newCredentials)
  }

  const updateCredential = (index: number, field: keyof GitCredential, value: string) => {
    const newCredentials = [...gitCredentials]
    newCredentials[index] = { ...newCredentials[index], [field]: value }
    setGitCredentials(newCredentials)
    checkForChanges(newCredentials)
  }

  const removeCredential = (index: number) => {
    const newCredentials = gitCredentials.filter((_, i) => i !== index)
    setGitCredentials(newCredentials)
    checkForChanges(newCredentials)
  }

  const saveCredentials = async () => {
    const validCredentials = gitCredentials.filter(cred => cred.name && cred.host && cred.token)
    
    setIsSaving(true)
    try {
      showToast.loading('Saving credentials and restarting server...', { id: 'git-credentials' })
      await updateSettingsAsync({ gitCredentials: validCredentials })
      setHasChanges(false)
      showToast.success('Git credentials updated', { id: 'git-credentials' })
    } catch {
      showToast.error('Failed to update git credentials', { id: 'git-credentials' })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-6">General Preferences</h2>

      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="theme">Theme</Label>
          <Select
            value={preferences?.theme || 'dark'}
            onValueChange={(value) => updateSettings({ theme: value as 'dark' | 'light' | 'system' })}
          >
            <SelectTrigger id="theme">
              <SelectValue placeholder="Select a theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Choose your preferred color scheme
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="mode">Mode</Label>
          <Select
            value={preferences?.mode || 'build'}
            onValueChange={(value) => updateSettings({ mode: value as 'plan' | 'build' })}
          >
            <SelectTrigger id="mode">
              <SelectValue placeholder="Select a mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plan">Plan</SelectItem>
              <SelectItem value="build">Build</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Plan mode: Read-only. Build mode: File changes enabled
          </p>
        </div>

        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="autoScroll" className="text-base">Auto-scroll</Label>
            <p className="text-sm text-muted-foreground">
              Automatically scroll to bottom when new messages arrive
            </p>
          </div>
          <Switch
            id="autoScroll"
            checked={preferences?.autoScroll ?? true}
            onCheckedChange={(checked) => updateSettings({ autoScroll: checked })}
          />
        </div>

        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="showReasoning" className="text-base">Show reasoning</Label>
            <p className="text-sm text-muted-foreground">
              Display model reasoning and thought process
            </p>
          </div>
          <Switch
            id="showReasoning"
            checked={preferences?.showReasoning ?? false}
            onCheckedChange={(checked) => updateSettings({ showReasoning: checked })}
          />
        </div>

        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="expandToolCalls" className="text-base">Expand tool calls</Label>
            <p className="text-sm text-muted-foreground">
              Automatically expand tool call details by default
            </p>
          </div>
          <Switch
            id="expandToolCalls"
            checked={preferences?.expandToolCalls ?? false}
            onCheckedChange={(checked) => updateSettings({ expandToolCalls: checked })}
          />
        </div>

        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="expandDiffs" className="text-base">Expand diffs</Label>
            <p className="text-sm text-muted-foreground">
              Show file diffs expanded by default for edit operations
            </p>
          </div>
          <Switch
            id="expandDiffs"
            checked={preferences?.expandDiffs ?? true}
            onCheckedChange={(checked) => updateSettings({ expandDiffs: checked })}
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground">Git Credentials</h3>
              <p className="text-sm text-muted-foreground">
                Add credentials for cloning private repositories from any Git host
              </p>
            </div>
            <div className="flex gap-2">
              {hasChanges && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={saveCredentials}
                  disabled={isSaving}
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Save
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCredential}
                disabled={isSaving}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
          </div>

          {gitCredentials.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No git credentials configured. Click "Add" to add credentials for GitHub, GitLab, Gitea, or other Git hosts.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {gitCredentials.map((cred, index) => (
                <div key={index} className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Input
                      placeholder="Credential name (e.g., GitHub Personal, Work GitLab)"
                      value={cred.name}
                      onChange={(e) => updateCredential(index, 'name', e.target.value)}
                      disabled={isSaving}
                      className="bg-background border-border text-foreground placeholder:text-muted-foreground font-medium"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCredential(index)}
                      disabled={isSaving}
                      className="ml-2 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Host URL</Label>
                      <Input
                        placeholder="https://github.com/"
                        value={cred.host}
                        onChange={(e) => updateCredential(index, 'host', e.target.value)}
                        disabled={isSaving}
                        className="bg-background border-border text-foreground placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Username (optional)</Label>
                      <Input
                        placeholder="Auto-detected if empty"
                        value={cred.username || ''}
                        onChange={(e) => updateCredential(index, 'username', e.target.value)}
                        disabled={isSaving}
                        className="bg-background border-border text-foreground placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Access Token</Label>
                    <Input
                      type="password"
                      placeholder="Personal access token"
                      value={cred.token}
                      onChange={(e) => updateCredential(index, 'token', e.target.value)}
                      disabled={isSaving}
                      className="bg-background border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          
          <p className="text-xs text-muted-foreground">
            Username defaults: github.com uses "x-access-token", gitlab.com uses "oauth2". For other hosts, specify your username if required.
          </p>
        </div>

        {isUpdating && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Saving...</span>
          </div>
        )}
      </div>

      <div className="mt-6">
        <TTSSettings />
      </div>
    </div>
  )
}
