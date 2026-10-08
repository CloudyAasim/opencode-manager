import { memo, useCallback, useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { FilePreview } from "./FilePreview";
import { FullscreenSheet } from "@/components/ui/fullscreen-sheet";
import type { FileInfo } from "@/types/files";
import { GPU_ACCELERATED_STYLE, MODAL_TRANSITION_MS } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useSwipeBack } from "@/hooks/useMobile";

interface MobileFilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: FileInfo | null;
  showFilePreviewHeader?: boolean;
}

export const MobileFilePreviewModal = memo(function MobileFilePreviewModal({
  isOpen,
  onClose,
  file,
  showFilePreviewHeader = false,
}: MobileFilePreviewModalProps) {
  const [localFile, setLocalFile] = useState<FileInfo | null>(null);
  const isClosingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  
  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    onClose();
    setTimeout(() => {
      setLocalFile(null);
      isClosingRef.current = false;
    }, MODAL_TRANSITION_MS);
  }, [onClose]);
  
  const { bind, swipeStyles } = useSwipeBack(handleClose, {
    enabled: isOpen,
  });
  
  useEffect(() => {
    return bind(containerRef.current);
  }, [bind]);

  useEffect(() => {
    if (isOpen && file && !file.isDirectory) {
      setLocalFile(file);
      isClosingRef.current = false;
    }
  }, [isOpen, file]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, handleClose]);

  if (!isOpen || !localFile) {
    return null;
  }

  return (
    <div ref={containerRef} style={{ isolation: 'isolate' }}>
      <FullscreenSheet style={{ ...GPU_ACCELERATED_STYLE, ...swipeStyles }}>
        <div className={`h-full overflow-hidden bg-background pt-safe ${showFilePreviewHeader ? "" : "pb-8"}`}>
          <FilePreview
            key={localFile.path}
            file={localFile}
            hideHeader={!showFilePreviewHeader}
            isMobileModal={showFilePreviewHeader}
            onCloseModal={handleClose}
          />
        </div>
        {/*
          The way out, owned by the modal rather than by the header it happens
          to be showing.

          The only caller never passes `showFilePreviewHeader`, so `hideHeader`
          was true and the X in FilePreview's header was not rendered - that
          button is gated on `isMobileModal`, which is gated on the same flag.
          A file opened from the listing therefore had no close control at
          all: only a swipe from the left edge or the system back button, on a
          screen where the system back button is easy to miss and a swipe-back
          is easy to trigger by accident while trying to scroll.

          Rendering it here rather than loosening the header condition keeps
          the X in exactly one place at a time: when a header is shown the
          header owns the button, and when one is not, this does.
        */}
        {!showFilePreviewHeader && (
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('ui.filePreview.close')}
            className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground backdrop-blur-sm hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </FullscreenSheet>
    </div>
  );
})
