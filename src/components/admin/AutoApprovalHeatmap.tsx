/**
 * Auto-approval heatmap: action_type × tenant grid.
 * Cell color = auto-approved share (green=high, yellow=mixed, gray=manual-only).
 * Працює на вже завантажених decisions (без додаткових запитів до БД).
 */
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type HeatmapDecision = {
  tenant_id: string;
  action_type: string;
  approved_by_auto: boolean | null;
  payload: Record<string, unknown> | null;
};

type Props = {
  decisions: HeatmapDecision[];
  tenantNameById: Map<string, string>;
};

function isAuto(d: HeatmapDecision): boolean {
  if (d.approved_by_auto) return true;
  const mode = (d.payload as { approval_mode?: string } | null)?.approval_mode;
  return mode === "history" || mode === "bootstrap";
}

function cellTone(autoShare: number, total: number) {
  if (total === 0) return "bg-muted/20";
  if (autoShare >= 0.66) return "bg-success/30 text-success-foreground";
  if (autoShare >= 0.33) return "bg-warning/30 text-warning-foreground";
  if (autoShare > 0) return "bg-warning/15";
  return "bg-muted/40 text-muted-foreground";
}

export function AutoApprovalHeatmap({ decisions, tenantNameById }: Props) {
  const { types, tenantIds, cells } = useMemo(() => {
    const typesSet = new Set<string>();
    const tenantsSet = new Set<string>();
    const map = new Map<string, { total: number; auto: number }>();
    for (const d of decisions) {
      typesSet.add(d.action_type);
      tenantsSet.add(d.tenant_id);
      const k = `${d.tenant_id}::${d.action_type}`;
      const cur = map.get(k) ?? { total: 0, auto: 0 };
      cur.total += 1;
      if (isAuto(d)) cur.auto += 1;
      map.set(k, cur);
    }
    return {
      types: Array.from(typesSet).sort(),
      tenantIds: Array.from(tenantsSet).sort((a, b) =>
        (tenantNameById.get(a) ?? a).localeCompare(tenantNameById.get(b) ?? b),
      ),
      cells: map,
    };
  }, [decisions, tenantNameById]);

  if (decisions.length === 0) {
    return <p className="text-sm text-muted-foreground">Немає даних для heatmap.</p>;
  }

  return (
    <TooltipProvider>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-background p-1 text-left font-medium text-muted-foreground">
                tenant ↓ / action →
              </th>
              {types.map((t) => (
                <th key={t} className="p-1 text-left font-medium text-muted-foreground" title={t}>
                  <div className="max-w-[100px] truncate">{t}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tenantIds.map((tid) => (
              <tr key={tid}>
                <td className="sticky left-0 z-10 max-w-[160px] truncate bg-background p-1 pr-3 font-medium">
                  {tenantNameById.get(tid) ?? tid.slice(0, 8)}
                </td>
                {types.map((t) => {
                  const c = cells.get(`${tid}::${t}`) ?? { total: 0, auto: 0 };
                  const share = c.total > 0 ? c.auto / c.total : 0;
                  return (
                    <td key={t}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              "flex h-8 min-w-[44px] items-center justify-center rounded text-[11px] tabular-nums",
                              cellTone(share, c.total),
                            )}
                          >
                            {c.total > 0 ? `${c.auto}/${c.total}` : "—"}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="space-y-0.5 text-xs">
                            <div className="font-medium">{t}</div>
                            <div className="text-muted-foreground">
                              {tenantNameById.get(tid) ?? tid.slice(0, 8)}
                            </div>
                            <div>
                              auto: {c.auto} / {c.total} ({Math.round(share * 100)}%)
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}
