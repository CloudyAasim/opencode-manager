import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCallback } from 'react'
import { useI18n, setLocale } from '@/lib/i18n'
import { zhCN } from './locales/zh-CN'

/**
 * `react-hooks/exhaustive-deps` had been reporting a missing `t` in
 * FilePreview for a long time, and it was written off as a baseline warning.
 * It was not one: react-i18next's t captures the language it was created
 * with, so a callback that omits t keeps speaking the old language after the
 * user switches. The save-failure toast said "Failed to save" in English to a
 * user who had chosen Chinese.
 *
 * Both halves are here so the fix cannot be undone quietly: listing t is what
 * makes the callback follow the language, and omitting it is what makes it
 * not. The second callback exists to keep that second claim honest.
 */
describe('a callback that calls t()', () => {
  it('follows the language when t is a dependency, and does not when it is not', async () => {
    const { result } = renderHook(() => {
      const { t } = useI18n()
      const withT = useCallback(() => t('misc.sourceControl.title'), [t])
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const withoutT = useCallback(() => t('misc.sourceControl.title'), [])
      return { withT, withoutT }
    })

    const english = 'Source Control'
    const chinese = zhCN.misc.sourceControl.title
    expect(result.current.withT()).toBe(english)
    expect(result.current.withoutT()).toBe(english)

    await act(async () => {
      setLocale('zh-CN')
    })
    // prove the switch landed, so the comparison below means something
    await waitFor(() => {
      expect(result.current.withT()).toBe(chinese)
    })

    expect(result.current.withT()).toBe(chinese)
    // the reason the dependency exists, and the reason the FilePreview fix
    // is a one-word change rather than a shrug
    expect(result.current.withoutT()).toBe(english)
  })
})
