/**
 * LoyaltyCard — owner control panel for the tenant's loyalty program.
 * Renders a single editable program (1:1 per tenant via UNIQUE(tenant_id)).
 *
 * Lets the owner:
 *  - toggle the program on/off
 *  - tune earn rate (points per 100 UAH)
 *  - set the value of 1 point in UAH
 *  - set min redeem threshold
 *  - rename
 *
 * Also surfaces top-line stats: total accounts, lifetime points awarded,
 * points currently outstanding (liability).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Award, Loader2, Save, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

type Program = {
  id: string;
  tenant_id: string;
  name: string;
  points_per_100_uah: number;
  uah_per_point: number;
  min_redeem_points: number;
  is_active: boolean;
};

export function LoyaltyCard({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();

  const programQuery = useQuery({
    queryKey: ["loyalty-program", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loyalty_programs")
        .select("id, tenant_id, name, points_per_100_uah, uah_per_point, min_redeem_points, is_active")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Program | null;
    },
  });

  const statsQuery = useQuery({
    queryKey: ["loyalty-stats", tenantId],
    queryFn: async () => {
      const { data: accounts, error: aErr } = await supabase
        .from("loyalty_accounts")
        .select("balance_points, lifetime_points")
        .eq("tenant_id", tenantId);
      if (aErr) throw aErr;
      const list = accounts ?? [];
      return {
        accounts: list.length,
        outstanding: list.reduce((s, a) => s + (a.balance_points ?? 0), 0),
        lifetime: list.reduce((s, a) => s + (a.lifetime_points ?? 0), 0),
      };
    },
  });

  const [name, setName] = useState("Програма лояльності");
  const [pointsPer100, setPointsPer100] = useState("1");
  const [uahPerPoint, setUahPerPoint] = useState("1.0");
  const [minRedeem, setMinRedeem] = useState("100");
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const p = programQuery.data;
    if (!p) return;
    setName(p.name);
    setPointsPer100(String(p.points_per_100_uah));
    setUahPerPoint(String(p.uah_per_point));
    setMinRedeem(String(p.min_redeem_points));
    setIsActive(p.is_active);
  }, [programQuery.data]);

  const upsert = useMutation({
    mutationFn: async () => {
      const payload = {
        tenant_id: tenantId,
        name: name.trim() || "Програма лояльності",
        points_per_100_uah: Math.max(1, parseInt(pointsPer100) || 1),
        uah_per_point: Math.max(0.01, parseFloat(uahPerPoint) || 1),
        min_redeem_points: Math.max(1, parseInt(minRedeem) || 100),
        is_active: isActive,
      };
      const { error } = await supabase
        .from("loyalty_programs")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Програму лояльності збережено");
      qc.invalidateQueries({ queryKey: ["loyalty-program", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (programQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="h-4 w-4 text-primary" />
              Програма лояльності
            </CardTitle>
            <CardDescription className="text-xs">
              Бали за кожне замовлення → знижка на наступне. Тіри: Бронза → Срібло (500 балів) → Золото (2000) → Платина (5000).
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="loyalty-active" className="text-xs text-muted-foreground">
              {isActive ? "Активна" : "Вимкнена"}
            </Label>
            <Switch id="loyalty-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <Stat
            icon={<Users className="h-3 w-3" />}
            label="Учасників"
            value={statsQuery.data ? String(statsQuery.data.accounts) : "—"}
          />
          <Stat
            icon={<Sparkles className="h-3 w-3" />}
            label="Балів видано"
            value={statsQuery.data ? statsQuery.data.lifetime.toLocaleString("uk-UA") : "—"}
          />
          <Stat
            icon={<Award className="h-3 w-3" />}
            label="В обігу"
            value={statsQuery.data ? statsQuery.data.outstanding.toLocaleString("uk-UA") : "—"}
          />
        </div>

        {/* Form */}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="loyalty-name" className="text-xs">Назва</Label>
            <Input
              id="loyalty-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div>
            <Label htmlFor="loyalty-rate" className="text-xs">Балів за 100 грн</Label>
            <Input
              id="loyalty-rate"
              type="number"
              min={1}
              max={100}
              value={pointsPer100}
              onChange={(e) => setPointsPer100(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="loyalty-value" className="text-xs">Вартість 1 балу (грн)</Label>
            <Input
              id="loyalty-value"
              type="number"
              step="0.01"
              min={0.01}
              max={100}
              value={uahPerPoint}
              onChange={(e) => setUahPerPoint(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="loyalty-min" className="text-xs">Мін. балів для списання</Label>
            <Input
              id="loyalty-min"
              type="number"
              min={1}
              max={10000}
              value={minRedeem}
              onChange={(e) => setMinRedeem(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 p-3 text-xs text-muted-foreground">
          <p>
            <strong className="text-foreground">Приклад:</strong> при покупці на 500 грн клієнт отримає{" "}
            <span className="font-mono text-foreground">
              {Math.floor((parseInt(pointsPer100) || 1) * 5)} балів
            </span>
            . Витративши {minRedeem || 100} балів, він отримає знижку{" "}
            <span className="font-mono text-foreground">
              {((parseInt(minRedeem) || 100) * (parseFloat(uahPerPoint) || 1)).toFixed(2)} грн
            </span>{" "}
            (макс 50% від замовлення).
          </p>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={() => upsert.mutate()} disabled={upsert.isPending}>
            {upsert.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Зберегти
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}
