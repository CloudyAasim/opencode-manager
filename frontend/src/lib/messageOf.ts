/** The one way an unknown error becomes a sentence. Every error toast in the
 *  app runs it through here, so a rejection that is not an Error still reads
 *  like something instead of `[object Object]`. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}
