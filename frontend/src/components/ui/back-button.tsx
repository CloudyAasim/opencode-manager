import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface BackButtonProps {
  to?: string;
  className?: string;
}

export function BackButton({ to = "/", className = "" }: BackButtonProps) {
  const navigate = useNavigate();
  const { t } = useI18n();

  const handleBack = () => {
    navigate(to);
  };

  return (
    <button
      onClick={handleBack}
      aria-label={t('ui.backButton.goBack')}
      className={`text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105 text-sm md:text-md border border-border rounded-md px-3 py-1.5 hover ${className}`}
    >
      <ArrowLeft className="w-4 h-4" />
    </button>
  );
}
