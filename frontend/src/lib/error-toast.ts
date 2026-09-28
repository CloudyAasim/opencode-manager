import { toast } from 'sonner'

export function showErrorToast(error: unknown, fallback: string): void {
  toast.error(error instanceof Error && error.message ? error.message : fallback)
}
