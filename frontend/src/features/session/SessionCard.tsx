import { useRef, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { SessionStatusIndicator } from "@/components/ui/session-status-indicator";
import { Trash2, Clock, MoreVertical, Pin, PinOff, Pencil, Check, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Session } from "@/api/types";
import { useSwipe } from "@/hooks/useSwipe";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useI18n } from '@/lib/i18n';

function displaySessionTitle(title: string | undefined, t: (key: string) => string): string {
  if (!title || /^New session - /.test(title)) return t('session.card.untitled')
  return title
}

interface SessionCardProps {
  session: Session;
  isSelected: boolean;
  isActive: boolean;
  manageMode: boolean;
  workspaceLabel?: string;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onRename?: (title: string) => void;
  onSelect: (sessionID: string) => void;
  onToggleSelection: (selected: boolean) => void;
  onDelete: (e: React.MouseEvent) => void;
}

export const SessionCard = ({
  session,
  isSelected,
  isActive,
  manageMode,
  workspaceLabel,
  isPinned,
  onTogglePin,
  onRename,
  onSelect,
  onToggleSelection,
  onDelete,
}: SessionCardProps) => {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const { bind, swipeOffset, isOpen, isSwipingBack, close, swipeStyles } = useSwipe();

  useEffect(() => {
    if (cardRef.current) {
      return bind(cardRef.current);
    }
  }, [bind]);

  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(e);
    close();
  };

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftTitle(session.title ?? '');
    setIsRenaming(true);
  };

  const commitRename = () => {
    const next = draftTitle.trim();
    setIsRenaming(false);
    if (next && next !== session.title) onRename?.(next);
  };

  return (
    <div className="relative" onClick={close}>
      <div
        className={`absolute top-0.5 right-0 bottom-0.5 w-20 bg-red-600 flex items-center justify-center rounded-r-lg transition-opacity ${
          !isSwipingBack && (isOpen || swipeOffset > 40) ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          aria-label={t('session.card.deleteAria')}
          className="h-full w-full flex items-center justify-center text-white hover:bg-red-700"
          onClick={handleDeleteClick}
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
      <div ref={cardRef} style={swipeStyles}>
        <Card
          className={`p-2 cursor-pointer transition-all overflow-hidden ${
            isOpen
              ? "rounded-none"
              : "rounded-r-lg"
          } ${
            isSelected
              ? "border-blue-500 shadow-lg shadow-blue-900/30 dark:shadow-blue-900/30 bg-accent"
              : isActive
                ? "bg-accent border-border"
                : "bg-card border-border hover:bg-accent hover:border-border"
          } hover:shadow-lg`}
          onClick={() => {
            if (!isOpen) {
              if (manageMode) {
                onToggleSelection(!isSelected);
              } else {
                onSelect(session.id);
              }
            }
          }}
        >
          <div className="flex items-start justify-between gap-2">
            {manageMode ? (
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <div className="flex flex-col items-center gap-2 flex-shrink-0">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => {
                        onToggleSelection(checked === true);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className="w-5 h-5 flex-shrink-0"
                    />
                    <SessionStatusIndicator sessionID={session.id} size="sm" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    {isPinned && <Pin className="w-3 h-3 text-warning shrink-0" />}
                    <h3 className="text-base font-semibold text-primary truncate">
                      {displaySessionTitle(session.title, t)}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(session.time.updated), {
                        addSuffix: true,
                      })}
                    </span>
                    {workspaceLabel ? (
                      <span className="text-purple-400 truncate max-w-[140px]">{workspaceLabel}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    {isPinned && <Pin className="w-3 h-3 text-warning shrink-0" />}
                    {isRenaming ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <input
                          autoFocus
                          value={draftTitle}
                          aria-label={t('session.card.renameAria')}
                          placeholder={t('session.card.renamePlaceholder')}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') setIsRenaming(false)
                          }}
                          className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('common.save')}
                          className="h-7 w-7 shrink-0 p-0"
                          onClick={(e) => { e.stopPropagation(); commitRename() }}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('common.cancel')}
                          className="h-7 w-7 shrink-0 p-0"
                          onClick={(e) => { e.stopPropagation(); setIsRenaming(false) }}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <h3 className="text-sm font-semibold text-primary truncate">
                        {displaySessionTitle(session.title, t)}
                      </h3>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center">
                      <Clock className="w-3 h-3 mr-1" />
                      {formatDistanceToNow(new Date(session.time.updated), {
                        addSuffix: true,
                      })}
                    </span>
                    {workspaceLabel ? (
                      <span className="text-purple-400 truncate max-w-[120px]">{workspaceLabel}</span>
                    ) : null}
                    <SessionStatusIndicator sessionID={session.id} size="sm" />
                  </div>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={t('session.card.actionsAria')}
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="z-[200]"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {onTogglePin && (
                        <DropdownMenuItem onClick={() => onTogglePin()}>
                          {isPinned ? <PinOff className="w-4 h-4 mr-2" /> : <Pin className="w-4 h-4 mr-2" />}
                          {isPinned ? t('session.card.unpin') : t('session.card.pinToTop')}
                        </DropdownMenuItem>
                      )}
                      {onRename && (
                        <DropdownMenuItem onClick={startRename}>
                          <Pencil className="w-4 h-4 mr-2" />
                          {t('session.card.rename')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={handleDeleteClick}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        {t('session.list.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
              </>
            )}
            {manageMode && (
              <button
                aria-label={t('session.card.deleteAria')}
                className="h-6 w-6 p-0 text-foreground hover:text-red-600 dark:hover:text-red-400 bg-transparent border-none cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(e);
                }}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
