import { useNotifications } from "@/hooks/useNotifications";
import { PanelLoading } from '@/components/ui/panel-loading'
import { Loader2, BellOff, Trash2, Send, Monitor } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { showToast } from "@/lib/toast";
import { formatDistanceToNow } from "date-fns";
import { useI18n } from "@/lib/i18n";

export function NotificationSettings() {
  const { t } = useI18n();
  const {
    isSupported,
    isAvailable,
    permission,
    isEnabled,
    preferences,
    subscriptions,
    isLoadingSubscriptions,
    enable,
    disable,
    updateEventPreference,
    removeDevice,
    sendTest,
    isSubscribing,
    isTesting,
  } = useNotifications();

  if (!isSupported) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          {t("settingsPanels.notifications.title")}
        </h2>
        <div className="flex items-center gap-3 text-muted-foreground">
          <BellOff className="h-5 w-5" />
          <p className="text-sm">
            {t("settingsPanels.notifications.unsupported")}
          </p>
        </div>
      </div>
    );
  }

  if (!isAvailable) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          {t("settingsPanels.notifications.title")}
        </h2>
        <div className="flex items-center gap-3 text-muted-foreground">
          <BellOff className="h-5 w-5" />
          <p className="text-sm">
            {t("settingsPanels.notifications.unavailable")}
          </p>
        </div>
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          {t("settingsPanels.notifications.title")}
        </h2>
        <div className="flex items-center gap-3 text-yellow-500">
          <BellOff className="h-5 w-5" />
          <p className="text-sm">
            {t("settingsPanels.notifications.denied")}
          </p>
        </div>
      </div>
    );
  }

  const handleEnable = async () => {
    try {
      await enable();
      showToast.success(t("settingsPanels.notifications.enabledToast"));
    } catch {
      showToast.error(t("settingsPanels.notifications.enableFailed"));
    }
  };

  const handleDisable = async () => {
    try {
      await disable();
      showToast.success(t("settingsPanels.notifications.disabledToast"));
    } catch {
      showToast.error(t("settingsPanels.notifications.disableFailed"));
    }
  };

  const handleTest = () => {
    sendTest(undefined, {
      onSuccess: (data) => {
        showToast.success(
          t("settingsPanels.notifications.testSent", { count: data.devicesNotified })
        );
      },
      onError: () => {
        showToast.error(t("settingsPanels.notifications.testFailed"));
      },
    });
  };

  return (
    <div className="@container w-full max-w-7xl space-y-6">
      <div className="grid gap-6 @min-[1000px]:grid-cols-[2fr_1fr] @min-[1000px]:items-start">
        <div className="min-w-0 bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold text-foreground mb-6">
            {t("settingsPanels.notifications.title")}
          </h2>

          <div className="space-y-6">
            <div className="divide-y divide-border">
              <div className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0 space-y-0.5">
                  <Label htmlFor="notificationsEnabled" className="text-base">
                    {t("settingsPanels.notifications.enableLabel")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("settingsPanels.notifications.enableDescription")}
                  </p>
                </div>
                <Switch
                  id="notificationsEnabled"
                  checked={isEnabled}
                  disabled={isSubscribing}
                  onCheckedChange={(checked) =>
                    checked ? handleEnable() : handleDisable()
                  }
                />
              </div>

              {isEnabled && (
                <>
                  <div className="py-3">
                    <h3 className="text-sm font-medium text-foreground">
                      {t("settingsPanels.notifications.eventsTitle")}
                    </h3>
                  </div>

                  <div className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <Label htmlFor="notifPermission" className="text-base">
                        {t("settingsPanels.notifications.permissionRequests")}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {t("settingsPanels.notifications.permissionRequestsDescription")}
                      </p>
                    </div>
                    <Switch
                      id="notifPermission"
                      checked={preferences.events.permissionAsked}
                      onCheckedChange={(checked) =>
                        updateEventPreference("permissionAsked", checked)
                      }
                    />
                  </div>

                  <div className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <Label htmlFor="notifQuestion" className="text-base">
                        {t("settingsPanels.notifications.agentQuestions")}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {t("settingsPanels.notifications.agentQuestionsDescription")}
                      </p>
                    </div>
                    <Switch
                      id="notifQuestion"
                      checked={preferences.events.questionAsked}
                      onCheckedChange={(checked) =>
                        updateEventPreference("questionAsked", checked)
                      }
                    />
                  </div>

                  <div className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <Label htmlFor="notifError" className="text-base">
                        {t("settingsPanels.notifications.sessionErrors")}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {t("settingsPanels.notifications.sessionErrorsDescription")}
                      </p>
                    </div>
                    <Switch
                      id="notifError"
                      checked={preferences.events.sessionError}
                      onCheckedChange={(checked) =>
                        updateEventPreference("sessionError", checked)
                      }
                    />
                  </div>

                  <div className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <Label htmlFor="notifIdle" className="text-base">
                        {t("settingsPanels.notifications.sessionCompletion")}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {t("settingsPanels.notifications.sessionCompletionDescription")}
                      </p>
                    </div>
                    <Switch
                      id="notifIdle"
                      checked={preferences.events.sessionIdle}
                      onCheckedChange={(checked) =>
                        updateEventPreference("sessionIdle", checked)
                      }
                    />
                  </div>
                </>
              )}
            </div>

            {isEnabled && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={isTesting || subscriptions.length === 0}
                >
                  {isTesting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  {t("settingsPanels.notifications.sendTest")}
                </Button>
              </div>
            )}
          </div>
        </div>

        {isEnabled && (
          <div className="min-w-0 bg-card border border-border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              {t("settingsPanels.notifications.registeredDevices")}
            </h2>

            {isLoadingSubscriptions ? (
              <PanelLoading className="py-4" size="md" />
            ) : subscriptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("settingsPanels.notifications.noDevices")}
              </p>
            ) : (
              <div className="space-y-3">
                {subscriptions.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Monitor className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {sub.deviceName ?? (sub.endpoint.length > 60 ? sub.endpoint.slice(0, 60) + "..." : sub.endpoint)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {sub.lastUsedAt
                            ? t("settingsPanels.notifications.lastUsed", { time: formatDistanceToNow(sub.lastUsedAt, { addSuffix: true }) })
                            : t("settingsPanels.notifications.added", { time: formatDistanceToNow(sub.createdAt, { addSuffix: true }) })}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive flex-shrink-0"
                      onClick={() => removeDevice(sub.id)}
                      aria-label={t('common.delete')}
                      title={t('common.delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
