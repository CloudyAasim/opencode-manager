import { useForm } from 'react-hook-form'
import { DialogLayout } from '@/components/ui/dialog-layout'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getRepoDisplayName } from '@/lib/utils'
import type { SkillFileInfo, CreateSkillRequest, UpdateSkillRequest, SkillScope } from '@opencode-manager/shared'
import type { Repo } from '@/api/types'
import { listRepos } from '@/api/repos'
import { useQuery } from '@tanstack/react-query'
import { useI18n, i18n } from '@/lib/i18n'

const skillFormSchema = z.object({
  name: z.string()
    .min(1, i18n.t('settingsPanels.skillDialog.errors.nameRequired'))
    .max(64, i18n.t('settingsPanels.skillDialog.errors.nameMax'))
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, i18n.t('settingsPanels.skillDialog.errors.nameFormat')),
  description: z.string().min(1, i18n.t('settingsPanels.skillDialog.errors.descriptionRequired')).max(1024, i18n.t('settingsPanels.skillDialog.errors.descriptionMax')),
  body: z.string().min(1, i18n.t('settingsPanels.skillDialog.errors.bodyRequired')),
  scope: z.enum(['global', 'project']),
})

type SkillFormValues = z.infer<typeof skillFormSchema>

interface SkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: CreateSkillRequest | (UpdateSkillRequest & { name: string; scope: SkillScope; repoId?: number })) => void
  editingSkill?: SkillFileInfo | null
}

export function SkillDialog({ open, onOpenChange, onSubmit, editingSkill }: SkillDialogProps) {
  const { t } = useI18n()
  const { data: repos = [] } = useQuery<Repo[]>({
    queryKey: ['repos'],
    queryFn: listRepos,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>(undefined)

  const getDefaultValues = (skill?: SkillFileInfo | null): SkillFormValues => {
    return {
      name: skill?.name || '',
      description: skill?.description || '',
      body: skill?.body || '',
      scope: skill?.scope || 'global',
    }
  }

  const form = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: getDefaultValues(editingSkill)
  })

  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues(editingSkill))
      if (editingSkill?.repoId) {
        setSelectedRepoId(editingSkill.repoId)
      }
    }
  }, [open, editingSkill, form])

  const handleSubmit = (values: SkillFormValues) => {
    if (!editingSkill && values.scope === 'project' && !selectedRepoId) {
      form.setError('scope', { message: t('settingsPanels.skillDialog.selectRepoForProject') })
      return
    }

    if (editingSkill) {
      onSubmit({
        name: editingSkill.name,
        scope: editingSkill.scope,
        repoId: editingSkill.scope === 'project' ? editingSkill.repoId : undefined,
        description: values.description,
        body: values.body,
      })
    } else {
      onSubmit({
        name: values.name,
        description: values.description,
        body: values.body,
        scope: values.scope,
        repoId: values.scope === 'project' ? selectedRepoId : undefined,
      })
    }
    form.reset()
    onOpenChange(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset()
    }
    onOpenChange(isOpen)
  }

  const scope = form.watch('scope')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
        <DialogLayout title={editingSkill ? t('settingsPanels.skillDialog.editTitle') : t('settingsPanels.skillDialog.createTitle')}>
          <Form {...form}>
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.skillDialog.name')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t('settingsPanels.skillDialog.namePlaceholder')}
                        disabled={!!editingSkill}
                        className={editingSkill ? 'bg-muted' : ''}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settingsPanels.skillDialog.nameHint')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.skillDialog.description')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t('settingsPanels.skillDialog.descriptionPlaceholder')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.skillDialog.body')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t('settingsPanels.skillDialog.bodyPlaceholder')}
                        rows={10}
                        className="font-mono md:text-sm"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="scope"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.skillDialog.scope')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!!editingSkill}>
                      <FormControl>
                        <SelectTrigger className={editingSkill ? 'bg-muted' : ''}>
                          <SelectValue placeholder={t('settingsPanels.skillDialog.selectScope')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="global">{t('settingsPanels.skillDialog.global')}</SelectItem>
                        <SelectItem value="project">{t('settingsPanels.skillDialog.project')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {scope === 'project' && (
                <FormItem>
                  <FormLabel>{t('settingsPanels.skillDialog.repository')}</FormLabel>
                  <FormControl>
                    <Select
                      value={selectedRepoId?.toString()}
                      onValueChange={(value) => setSelectedRepoId(value ? parseInt(value, 10) : undefined)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('settingsPanels.skillDialog.selectRepository')} />
                      </SelectTrigger>
                      <SelectContent>
                        {repos.map((repo) => (
                          <SelectItem key={repo.id} value={repo.id.toString()}>
                            {getRepoDisplayName(repo)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </div>
          </Form>
        </DialogLayout>

        <DialogFooter className="flex flex-row gap-2 pt-2 border-t border-border sm:justify-end pb-4 p-3">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1 sm:flex-none">
            {t('settingsPanels.skillDialog.cancel')}
          </Button>
          <Button
            onClick={() => form.handleSubmit(handleSubmit)()}
            disabled={!form.formState.isValid}
            className="flex-1 sm:flex-none"
          >
            {editingSkill ? t('settingsPanels.skillDialog.update') : t('settingsPanels.skillDialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
