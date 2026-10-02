import { Label } from '@/components/ui/label'
import { PanelLoading } from '@/components/ui/panel-loading'
import { TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { MultiSelect } from '@/components/ui/multi-select'
import { Sparkles } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

type SkillsTabProps = {
  skillSlugs: string[]
  onSkillSlugsChange: (value: string[]) => void
  skillNotes: string
  onSkillNotesChange: (value: string) => void
  skills: Array<{ name: string; description: string }>
  skillsLoading: boolean
}

export function SkillsTab({
  skillSlugs,
  onSkillSlugsChange,
  skillNotes,
  onSkillNotesChange,
  skills,
  skillsLoading,
}: SkillsTabProps) {
  const { t } = useI18n()

  return (
    <TabsContent value="skills" className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-5">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>{t('schedules.skills.selectLabel')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('schedules.skills.description')}
          </p>
        </div>

        {skillsLoading ? (
          <PanelLoading className="py-8" size="md" />
        ) : skills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center">
            <Sparkles className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('schedules.skills.empty')}</p>
          </div>
        ) : (
          <MultiSelect
            value={skillSlugs}
            onChange={onSkillSlugsChange}
            options={skills.map(s => ({ value: s.name, label: s.name, description: s.description }))}
            placeholder={t('schedules.skills.searchPlaceholder')}
          />
        )}

        <div className="space-y-2">
          <Label htmlFor="schedule-skill-notes">{t('schedules.skills.notes')}</Label>
          <Textarea
            id="schedule-skill-notes"
            value={skillNotes}
            onChange={(event) => onSkillNotesChange(event.target.value)}
            placeholder={t('schedules.skills.notesPlaceholder')}
            className="min-h-[80px]"
          />
        </div>
      </div>
    </TabsContent>
  )
}
