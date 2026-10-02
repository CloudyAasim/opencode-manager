import { useState, useEffect, useRef } from 'react'
import { PanelLoading } from '@/components/ui/panel-loading'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeEditor } from '@/components/ui/code-editor'
import { EditorFindBar } from '@/components/ui/editor-find-bar'
import { useFindInText } from '@/lib/useFindInText'
import { settingsApi } from '@/api/settings'
import { showToast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'

export function AgentsMdEditor() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const hasChanges = content !== savedContent
  const hasChangesRef = useRef(false)
  hasChangesRef.current = hasChanges
  const savedContentRef = useRef('')
  savedContentRef.current = savedContent

  const { data, isLoading, error } = useQuery({
    queryKey: ['agents-md'],
    queryFn: () => settingsApi.getAgentsMd(),
  })

  useEffect(() => {
    if (data?.content === undefined) return
    if (hasChangesRef.current) return
    if (data.content === savedContentRef.current) return
    setContent(data.content)
    setSavedContent(data.content)
  }, [data?.content])

  const updateMutation = useMutation({
    mutationFn: (newContent: string) => settingsApi.updateAgentsMd(newContent),
    onSuccess: (_data, newContent) => {
      setSavedContent(newContent)
      queryClient.invalidateQueries({ queryKey: ['agents-md'] })
      queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
      showToast.success(t('settingsPanels.agentsMd.saved'))
    },
    onError: () => {
      showToast.error(t('settingsPanels.agentsMd.saveFailed'))
    },
  })

  const resetToDefaultMutation = useMutation({
    mutationFn: async () => {
      const { content: defaultContent } = await settingsApi.getDefaultAgentsMd()
      await settingsApi.updateAgentsMd(defaultContent)
      return defaultContent
    },
    onSuccess: (defaultContent) => {
      queryClient.invalidateQueries({ queryKey: ['agents-md'] })
      setContent(defaultContent)
      setSavedContent(defaultContent)
      showToast.success(t('settingsPanels.agentsMd.resetToDefault'))
    },
    onError: () => {
      showToast.error(t('settingsPanels.agentsMd.resetFailed'))
    },
  })

  const isSaving = updateMutation.isPending || resetToDefaultMutation.isPending

  const handleSave = () => {
    updateMutation.mutate(content)
  }

  const handleResetToDefault = () => {
    resetToDefaultMutation.mutate()
  }

  const { query, setQuery, matches, currentMatchIndex, hasMatches, next, prev } = useFindInText(content)

  if (isLoading) {
    return (
      <PanelLoading className="py-8" size="md" />
    )
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        {t('settingsPanels.agentsMd.loadFailed')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-col gap-3 bg-background py-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {t('settingsPanels.agentsMd.description')}
          </p>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetToDefault}
            disabled={isSaving}
            className="flex-1 sm:flex-none"
          >
            {resetToDefaultMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-1" />
            )}
            {t('settingsPanels.agentsMd.resetButton')}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="flex-1 sm:flex-none"
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            {t('settingsPanels.agentsMd.save')}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-input">
        <EditorFindBar
          query={query}
          onQueryChange={setQuery}
          matchCount={matches.length}
          currentMatch={hasMatches ? currentMatchIndex + 1 : 0}
          onPrev={prev}
          onNext={next}
          inputName="agents-md-find"
          placeholder={t('settingsPanels.agentsMd.findPlaceholder')}
        />

        <div className="h-[60dvh] min-h-[320px] sm:h-[55vh]">
          <CodeEditor
            ariaLabel={t('settingsPanels.agentsMd.contentLabel')}
            value={content}
            onChange={setContent}
            highlights={matches}
            activeHighlightIndex={currentMatchIndex}
            disabled={isSaving}
            placeholder={t('settingsPanels.agentsMd.placeholder')}
          />
        </div>
      </div>

      {hasChanges && (
        <p className="text-xs text-amber-500">{t('settingsPanels.agentsMd.unsavedChanges')}</p>
      )}
    </div>
  )
}
