/**
 * MarketingSpendForm — manual entry for `acquisition_costs` per
 * (period_month, channel). Powers the CAC Payback Agent.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Save, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  id?: string;
  period_month: string; // YYYY-MM-01
  channel: string;
  spend_uah: string;
  new_customers: string;
  dirty?: boolean;
  saving?: boolean;
};

function lastMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    out.push(`${y}-${m}-01`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

function fmtMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("uk-UA", { year: "numeric", month: "long" });
}

export function MarketingSpendForm({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const months = useMemo(() => lastMonths(12), []);
  const [selectedMonth, setSelectedMonth] = useState(months[0]);
  const [draftRows, setDraftRows] = useState<Row[]>([]);

  const costsQuery = useQuery({
    queryKey: ["acquisition-costs", tenantId, selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("acquisition_costs")
        .select("id, period_month, channel, spend_cents, new_customers")
        .eq("tenant_id", tenantId)
        .eq("period_month", selectedMonth)
        .order("channel");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!tenantId,
  });

  const DEFAULT_CHANNELS = ["organic", "meta_ads", "google_ads", "instagram", "referral", "direct"];

  const channelsQuery = useQuery({
    queryKey: ["acquisition-channels", tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("acquisition_costs")
        .select("channel")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      const existing = [...new Set((data ?? []).map((r) => r.channel).filter(Boolean))];
      const merged = [...new Set([...existing, ...DEFAULT_CHANNELS])];
      return merged.sort();
    },
  });

  const saveMut = useMutation({
    mutationFn: async (row: Row) => {
      const spendCents = Math.round(parseFloat(row.spend_uah || "0") * 100);
      const newCustomers = parseInt(row.new_customers || "0", 10);
      const { error } = await supabase.rpc("upsert_acquisition_cost", {
        p_tenant_id: tenantId,
        p_period_month: row.period_month,
        p_channel: row.channel.trim(),
        p_spend_cents: spendCents,
        p_new_customers: newCustomers,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Збережено");
      qc.invalidateQueries({ queryKey: ["acquisition-costs", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const existingRows: Row[] = (costsQuery.data ?? []).map((r) => ({
    id: r.id,
    period_month: r.period_month,
    channel: r.channel,
    spend_uah: ((r.spend_cents ?? 0) / 100).toString(),
    new_customers: String(r.new_customers ?? 0),
  }));

  const allRows = [...existingRows, ...draftRows];

  const updateDraft = (idx: number, patch: Partial<Row>) => {
    setDraftRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch, dirty: true };
      return next;
    });
  };

  const updateExisting = async (row: Row, patch: Partial<Row>) => {
    const merged = { ...row, ...patch };
    if (!merged.channel.trim()) return;
    await saveMut.mutateAsync(merged);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Маркетингові витрати
        </CardTitle>
        <CardDescription>
          Введіть бюджет та кількість нових клієнтів за місяць і каналом. Дані живлять
          CAC Payback Agent у /brand/roi.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Label htmlFor="month-pick" className="text-sm">
            Місяць
          </Label>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger id="month-pick" className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m} value={m}>
                  {fmtMonth(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {costsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Завантажую…</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground">
              <div className="col-span-4">Канал</div>
              <div className="col-span-4">Витрати (₴)</div>
              <div className="col-span-3">Нові клієнти</div>
              <div className="col-span-1"></div>
            </div>

            {existingRows.map((row) => (
              <RowEditor
                key={row.id}
                row={row}
                channels={channelsQuery.data ?? []}
                onSave={(patch) => updateExisting(row, patch)}
                saving={saveMut.isPending}
              />
            ))}

            {draftRows.map((row, idx) => (
              <div key={`draft-${idx}`} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-4">
                  <Input
                    list="channel-suggestions"
                    placeholder="канал"
                    value={row.channel}
                    onChange={(e) => updateDraft(idx, { channel: e.target.value })}
                  />
                </div>
                <div className="col-span-4">
                  <Input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={row.spend_uah}
                    onChange={(e) => updateDraft(idx, { spend_uah: e.target.value })}
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={row.new_customers}
                    onChange={(e) => updateDraft(idx, { new_customers: e.target.value })}
                  />
                </div>
                <div className="col-span-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={!row.channel.trim() || saveMut.isPending}
                    onClick={async () => {
                      await saveMut.mutateAsync(row);
                      setDraftRows((prev) => prev.filter((_, i) => i !== idx));
                    }}
                  >
                    {saveMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}

            <datalist id="channel-suggestions">
              {(channelsQuery.data ?? []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>

            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDraftRows((prev) => [
                  ...prev,
                  {
                    period_month: selectedMonth,
                    channel: "",
                    spend_uah: "",
                    new_customers: "",
                  },
                ])
              }
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Додати канал
            </Button>

            {allRows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Немає записів за цей місяць. Додайте перший канал.
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Підказка: канали Meta Ads / Google Ads можна імпортувати автоматично — інтеграція
          буде доступна пізніше.
        </p>
      </CardContent>
    </Card>
  );
}

function RowEditor({
  row,
  channels,
  onSave,
  saving,
}: {
  row: Row;
  channels: string[];
  onSave: (patch: Partial<Row>) => void;
  saving: boolean;
}) {
  const [spend, setSpend] = useState(row.spend_uah);
  const [nc, setNc] = useState(row.new_customers);
  const dirty = spend !== row.spend_uah || nc !== row.new_customers;

  return (
    <div className="grid grid-cols-12 gap-2 items-center">
      <div className="col-span-4 text-sm font-medium">{row.channel}</div>
      <div className="col-span-4">
        <Input
          type="number"
          min={0}
          value={spend}
          onChange={(e) => setSpend(e.target.value)}
          onBlur={() => {
            if (dirty) onSave({ spend_uah: spend, new_customers: nc });
          }}
        />
      </div>
      <div className="col-span-3">
        <Input
          type="number"
          min={0}
          value={nc}
          onChange={(e) => setNc(e.target.value)}
          onBlur={() => {
            if (dirty) onSave({ spend_uah: spend, new_customers: nc });
          }}
        />
      </div>
      <div className="col-span-1 text-right text-xs text-muted-foreground">
        {saving && dirty ? <Loader2 className="ml-auto h-3 w-3 animate-spin" /> : null}
      </div>
    </div>
  );
}
