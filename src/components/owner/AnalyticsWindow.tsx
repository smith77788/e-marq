/**
 * Shared analytics window state (7d / 30d / 90d) for the brand dashboard.
 * Provider lives near the top of /brand and child KPI/chart components consume it.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "lucide-react";

export type AnalyticsWindowDays = 7 | 30 | 90;

type Ctx = {
  days: AnalyticsWindowDays;
  setDays: (d: AnalyticsWindowDays) => void;
  sinceMs: number;
  sinceIso: string;
};

const AnalyticsWindowCtx = createContext<Ctx | null>(null);

export function AnalyticsWindowProvider({ children, initial = 30 }: { children: ReactNode; initial?: AnalyticsWindowDays }) {
  const [days, setDays] = useState<AnalyticsWindowDays>(initial);
  const value = useMemo<Ctx>(() => {
    const sinceMs = Date.now() - days * 24 * 3600 * 1000;
    return { days, setDays, sinceMs, sinceIso: new Date(sinceMs).toISOString() };
  }, [days]);
  return <AnalyticsWindowCtx.Provider value={value}>{children}</AnalyticsWindowCtx.Provider>;
}

export function useAnalyticsWindow(): Ctx {
  const ctx = useContext(AnalyticsWindowCtx);
  if (!ctx) throw new Error("useAnalyticsWindow must be used within AnalyticsWindowProvider");
  return ctx;
}

const OPTIONS: AnalyticsWindowDays[] = [7, 30, 90];

export function AnalyticsWindowToggle({ className }: { className?: string }) {
  const { days, setDays } = useAnalyticsWindow();
  return (
    <div className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="inline-flex rounded-md border border-border bg-card p-0.5">
        {OPTIONS.map((opt) => (
          <Button
            key={opt}
            type="button"
            variant={days === opt ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setDays(opt)}
          >
            {opt}d
          </Button>
        ))}
      </div>
    </div>
  );
}
