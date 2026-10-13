const GIT_C_LOCALE_ENV: Record<string, string> = { LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' }

/**
 * `git-errors.ts` and `repo/clone.ts` recognise failures by matching git's own
 * English wording. A server started under a non-English locale gets translated
 * stderr instead, every one of those patterns silently stops matching, and a
 * clone failure reaches the user as raw untranslated output.
 *
 * Applied after the caller's env so an inherited value cannot win.
 */
export function childEnvFor(
  command: string,
  optionsEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env, ...optionsEnv }
  if (command === 'git') Object.assign(merged, GIT_C_LOCALE_ENV)
  return merged
}
