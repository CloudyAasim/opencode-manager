import { useMutation } from "@tanstack/react-query";
import { resetRepoPermissions } from "@/api/repos";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { showToast } from "@/lib/toast";
import { useI18n } from '@/lib/i18n'

interface ResetPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoId: number;
}

export function ResetPermissionsDialog({
  open,
  onOpenChange,
  repoId,
}: ResetPermissionsDialogProps) {
  const { t } = useI18n();
  const resetPermissionsMutation = useMutation({
    mutationFn: () => resetRepoPermissions(repoId),
    onSuccess: () => {
      showToast.success(t('repo.permissions.resetSuccess'));
      onOpenChange(false);
    },
    onError: () => {
      showToast.error(t('repo.permissions.resetFailed'));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('repo.permissions.resetTitle')}</DialogTitle>
          <DialogDescription>
            {t('repo.permissions.resetDescription')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={resetPermissionsMutation.isPending}
          >
            {t('repo.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => resetPermissionsMutation.mutate()}
            disabled={resetPermissionsMutation.isPending}
          >
            {resetPermissionsMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('repo.permissions.resetting')}
              </>
            ) : (
              t('repo.permissions.resetConfirm')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
