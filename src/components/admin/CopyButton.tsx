import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function CopyButton({
  value,
  label,
  className,
}: {
  value: unknown;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const onClick = async () => {
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      toast.success(label ? `${label} скопійовано` : "Скопійовано");
      setTimeout(() => setDone(false), 1200);
    } catch {
      toast.error("Не вдалося скопіювати");
    }
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`h-6 w-6 ${className ?? ""}`}
      onClick={onClick}
      aria-label="Скопіювати"
      title="Скопіювати"
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}
