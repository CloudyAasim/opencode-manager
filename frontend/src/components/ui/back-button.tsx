import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

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
    <Button
      variant="outline"
      size="sm"
      onClick={handleBack}
      aria-label={t('ui.backButton.goBack')}
      className={`text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105 ${className}`}
    >
      <ArrowLeft className="size-4" />
    </Button>
  );
}
