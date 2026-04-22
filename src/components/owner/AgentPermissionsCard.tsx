/**
 * AgentPermissionsCard — let an owner configure how a single agent behaves
 * for the active tenant: mode (off/suggest/auto), max risk for auto-apply,
 * notifications, and weekly run budget.
 *
 * Reads & writes the `agent_permissions` table (RLS guarded). When no row
 * exists for (tenant, agent), the card renders the safe defaults returned
 * by `get_agent_permission()` and creates the row on first save.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, Save, Shield, ShieldOff, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { getAgentMeta } from "@/lib/acos/agentCatalog";
import { RegionSelector } from "@/components/owner/RegionSelector";
import {
  parseGeoTargets,
  summarizeGeo,
  type GeoTargets,
} from "@/lib/acos/geoTargets";

export type AgentMode = "off" | "suggest" | "auto";
export type AgentRisk = "low" | "medium" | "high";

type Props = {
  tenantId: string;
  agentId: string;
};

type Row = {
  mode: AgentMode;
  auto_apply_max_risk: AgentRisk;
  notify_on_apply: boolean;
  weekly_run_limit: number;
  geo_targets: GeoTargets | null;
};

const DEFAULTS: Row = {
  mode: "suggest",
  auto_apply_max_risk: "medium",
  notify_on_apply: true,
  weekly_run_limit: 200,
  geo_targets: null,
};

/** Agents that benefit from a region override. */
const GEO_AWARE_AGENTS = new Set([
  "price-optimizer",
  "predictive-pricing",
  "time-of-day-pricer",
  "promo-portfolio",
  "promo-fatigue",
  "discount-elasticity",
  "geo-demand",
  "margin-optimizer",
  "shipping-optimizer",
  "seasonality-detector",
  "inventory-forecast",
]);

export function AgentPermissionsCard({ tenantId, agentId }: Props) {
  const { t } = useT();
  const qc = useQueryClient();
  const meta = getAgentMeta(agentId);
  const supportsAuto = meta?.supportsAutoApply ?? true;

  const queryKey = useMemo(() => ["agent-permission", tenantId, agentId], [tenantId, agentId]);

  const { data, isLoading } = useQuery({
    queryKey,
    enabled: Boolean(tenantId && agentId),
    queryFn: async (): Promise<Row> => {
      const { data, error } = await supabase
        .from("agent_permissions")
        .select("mode, auto_apply_max_risk, notify_on_apply, weekly_run_limit, geo_targets")
        .eq("tenant_id", tenantId)
        .eq("agent_id", agentId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return DEFAULTS;
      const d = data as Record<string, unknown>;
      return {
        mode: (d.mode as AgentMode) ?? DEFAULTS.mode,
        auto_apply_max_risk: (d.auto_apply_max_risk as AgentRisk) ?? DEFAULTS.auto_apply_max_risk,
        notify_on_apply: (d.notify_on_apply as boolean) ?? DEFAULTS.notify_on_apply,
        weekly_run_limit: (d.weekly_run_limit as number) ?? DEFAULTS.weekly_run_limit,
        geo_targets: parseGeoTargets(d.geo_targets),
      };
    },
  });

  const [draft, setDraft] = useState<Row>(DEFAULTS);
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const dirty = useMemo(() => {
    if (!data) return false;
    return (
      draft.mode !== data.mode ||
      draft.auto_apply_max_risk !== data.auto_apply_max_risk ||
      draft.notify_on_apply !== data.notify_on_apply ||
      draft.weekly_run_limit !== data.weekly_run_limit ||
      JSON.stringify(draft.geo_targets) !== JSON.stringify(data.geo_targets)
    );
  }, [draft, data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const userRes = await supabase.auth.getUser();
      const userId = userRes.data.user?.id ?? null;
      const payload = {
        tenant_id: tenantId,
        agent_id: agentId,
        mode: supportsAuto ? draft.mode : draft.mode === "auto" ? "suggest" : draft.mode,
        auto_apply_max_risk: draft.auto_apply_max_risk,
        notify_on_apply: draft.notify_on_apply,
        weekly_run_limit: draft.weekly_run_limit,
        last_changed_by: userId,
        geo_targets: (draft.geo_targets as unknown) ?? null,
      };
      const { error } = await supabase
        .from("agent_permissions")
        .upsert(payload as never, { onConflict: "tenant_id,agent_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("ag.cab.saved"));
      void qc.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => {
      toast.error(`${t("ag.cab.saveErr")}: ${err instanceof Error ? err.message : ""}`);
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" /> {t("ag.cab.permissions")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> …
        </CardContent>
      </Card>
    );
  }

  const modeIcon = draft.mode === "off" ? ShieldOff : draft.mode === "auto" ? Sparkles : Shield;
  const ModeIcon = modeIcon;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ModeIcon
            className={cn(
              "h-4 w-4",
              draft.mode === "auto" && "text-success",
              draft.mode === "off" && "text-muted-foreground",
              draft.mode === "suggest" && "text-warning",
            )}
          />
          {t("ag.cab.permissions")}
        </CardTitle>
        <CardDescription>{t("ag.cab.modeAutoDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Mode */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">{t("ag.cab.mode")}</Label>
          <RadioGroup
            value={draft.mode}
            onValueChange={(v) => setDraft({ ...draft, mode: v as AgentMode })}
            className="grid gap-2"
          >
            <ModeOption
              value="off"
              currentValue={draft.mode}
              title={t("ag.cab.modeOff")}
              desc={t("ag.cab.modeOffDesc")}
            />
            <ModeOption
              value="suggest"
              currentValue={draft.mode}
              title={t("ag.cab.modeSuggest")}
              desc={t("ag.cab.modeSuggestDesc")}
            />
            <ModeOption
              value="auto"
              currentValue={draft.mode}
              title={t("ag.cab.modeAuto")}
              desc={t("ag.cab.modeAutoDesc")}
              disabled={!supportsAuto}
              hint={!supportsAuto ? t("ag.cab.noAuto") : undefined}
            />
          </RadioGroup>
        </div>

        {/* Max risk for auto-apply (only when auto) */}
        <div className="space-y-2" aria-disabled={draft.mode !== "auto"}>
          <Label
            className={cn("text-sm font-medium", draft.mode !== "auto" && "text-muted-foreground")}
          >
            {t("ag.cab.maxRisk")}
          </Label>
          <Select
            value={draft.auto_apply_max_risk}
            onValueChange={(v) => setDraft({ ...draft, auto_apply_max_risk: v as AgentRisk })}
            disabled={draft.mode !== "auto"}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">{t("ag.cab.riskLow")}</SelectItem>
              <SelectItem value="medium">{t("ag.cab.riskMedium")}</SelectItem>
              <SelectItem value="high">{t("ag.cab.riskHigh")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Notify */}
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3">
          <div className="space-y-0.5">
            <Label htmlFor={`notify-${agentId}`} className="text-sm font-medium">
              {t("ag.cab.notify")}
            </Label>
          </div>
          <Switch
            id={`notify-${agentId}`}
            checked={draft.notify_on_apply}
            onCheckedChange={(v) => setDraft({ ...draft, notify_on_apply: v })}
          />
        </div>

        {/* Weekly limit */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{t("ag.cab.weeklyLimit")}</Label>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {draft.weekly_run_limit}
            </span>
          </div>
          <Slider
            value={[draft.weekly_run_limit]}
            min={10}
            max={1000}
            step={10}
            onValueChange={(v) => setDraft({ ...draft, weekly_run_limit: v[0] })}
          />
        </div>

        {/* Geo region override (only for geo-aware agents) */}
        {GEO_AWARE_AGENTS.has(agentId) && (
          <Collapsible defaultOpen={!!draft.geo_targets}>
            <div className="rounded-lg border border-border/60">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-muted/30">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  <div>
                    <div className="text-sm font-medium">Регіон агента</div>
                    <div className="text-xs text-muted-foreground">
                      {draft.geo_targets
                        ? summarizeGeo(draft.geo_targets)
                        : "Наслідується з налаштувань бренду"}
                    </div>
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t border-border/60 p-3">
                <RegionSelector
                  value={draft.geo_targets}
                  onChange={(g) => setDraft({ ...draft, geo_targets: g })}
                  inheritHint="За замовчуванням агент використовує регіон з налаштувань бренду. Задайте власний, щоб перевизначити."
                  onClear={() => setDraft({ ...draft, geo_targets: null })}
                  compact
                />
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}

        <Button
          onClick={() => saveMut.mutate()}
          disabled={!dirty || saveMut.isPending}
          className="w-full"
        >
          {saveMut.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> …
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" /> {t("ag.cab.save")}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function ModeOption({
  value,
  currentValue,
  title,
  desc,
  disabled,
  hint,
}: {
  value: AgentMode;
  currentValue: AgentMode;
  title: string;
  desc: string;
  disabled?: boolean;
  hint?: string;
}) {
  const active = value === currentValue;
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
        active ? "border-primary/60 bg-primary/5" : "border-border/60 hover:border-border",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <RadioGroupItem value={value} disabled={disabled} className="mt-0.5" />
      <div className="space-y-0.5">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
        {hint && <div className="text-xs italic text-muted-foreground">{hint}</div>}
      </div>
    </label>
  );
}
