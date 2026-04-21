/**
 * Brand → Promo codes. Owner-facing CRUD for the `promotions` table.
 * Supports three discount kinds: percent_off, fixed_off, free_shipping
 * (all aligned with `validate_discount_code` RPC used at checkout).
 *
 * Tenant scoping: ?tenant=<id> search param. RLS: promotions_admin_*
 * already restricts mutations to tenant admins / super_admin.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/i18n";
import { formatMoneyExact } from "@/lib/money";
import { EmailCampaignsCard } from "@/components/owner/EmailCampaignsCard";

type PromoType = "percent_off" | "fixed_off" | "free_shipping";

type PromoRow = {
  id: string;
  code: string | null;
  name: string;
  promo_type: string;
  value: number;
  min_order_cents: number;
  usage_limit: number | null;
  usage_per_customer: number;
  times_used: number;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
};

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand/promotions")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: BrandPromotionsPage,
});

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i += 1) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function fromLocalInput(s: string): string | null {
  if (!s) return null;
  return new Date(s).toISOString();
}

function BrandPromotionsPage() {
  const { tenant: tenantId } = useSearch({ from: "/_authenticated/brand/promotions" });
  const { user, loading } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const tenantsQuery = useQuery({
    queryKey: ["my-tenants", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!loading && tenantsQuery.data && tenantsQuery.data.length > 0 && !tenantId) {
    void navigate({
      to: "/brand/promotions",
      search: { tenant: tenantsQuery.data[0].id },
      replace: true,
    });
  }

  const current = tenantsQuery.data?.find((tt) => tt.id === tenantId);

  const promosQuery = useQuery({
    queryKey: ["brand-promotions", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("promotions")
        .select(
          "id, code, name, promo_type, value, min_order_cents, usage_limit, usage_per_customer, times_used, starts_at, ends_at, is_active",
        )
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PromoRow[];
    },
  });

  const [editing, setEditing] = useState<PromoRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PromoRow | null>(null);

  // Form state
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [promoType, setPromoType] = useState<PromoType>("percent_off");
  const [value, setValue] = useState<number>(10);
  const [minOrderUah, setMinOrderUah] = useState<number>(0);
  const [usageLimit, setUsageLimit] = useState<string>("");
  const [usagePerCustomer, setUsagePerCustomer] = useState<number>(1);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!editing && !creating) return;
    if (editing) {
      setCode(editing.code ?? "");
      setName(editing.name);
      setPromoType((editing.promo_type as PromoType) ?? "percent_off");
      setValue(Number(editing.value));
      setMinOrderUah(editing.min_order_cents / 100);
      setUsageLimit(editing.usage_limit !== null ? String(editing.usage_limit) : "");
      setUsagePerCustomer(editing.usage_per_customer);
      setStartsAt(toLocalInput(editing.starts_at));
      setEndsAt(toLocalInput(editing.ends_at));
      setIsActive(editing.is_active);
    } else {
      setCode("");
      setName("");
      setPromoType("percent_off");
      setValue(10);
      setMinOrderUah(0);
      setUsageLimit("");
      setUsagePerCustomer(1);
      setStartsAt("");
      setEndsAt("");
      setIsActive(true);
    }
  }, [editing, creating]);

  const closeForm = () => {
    setEditing(null);
    setCreating(false);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["brand-promotions", tenantId] });
  };

  const buildPayload = () => ({
    code: code.trim().toUpperCase() || null,
    name: name.trim(),
    promo_type: promoType,
    value: promoType === "free_shipping" ? 0 : value,
    min_order_cents: Math.max(0, Math.round(minOrderUah * 100)),
    usage_limit: usageLimit.trim() === "" ? null : Number(usageLimit),
    usage_per_customer: Math.max(1, usagePerCustomer),
    starts_at: fromLocalInput(startsAt) ?? new Date().toISOString(),
    ends_at: fromLocalInput(endsAt),
    is_active: isActive,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = { tenant_id: tenantId!, ...buildPayload() };
      const { error } = await supabase.from("promotions").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("bpr.created"));
      closeForm();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase
        .from("promotions")
        .update(buildPayload())
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("bpr.updated"));
      closeForm();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("promotions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("bpr.deleted"));
      setDeleting(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const promos = promosQuery.data ?? [];
  const isEmpty = !promosQuery.isLoading && promos.length === 0;
  const formOpen = creating || !!editing;
  const submitting = createMutation.isPending || updateMutation.isPending;

  const formatValue = (p: PromoRow) => {
    if (p.promo_type === "percent_off") return `${Number(p.value)}%`;
    if (p.promo_type === "fixed_off") return formatMoneyExact(Number(p.value) * 100);
    return "—";
  };

  const typeLabel = useMemo(
    () => ({
      percent_off: t("bpr.type.percent"),
      fixed_off: t("bpr.type.fixed"),
      free_shipping: t("bpr.type.shipping"),
    }),
    [t],
  );

  if (loading) return <p className="text-sm text-muted-foreground">Завантаження…</p>;

  if (!tenantsQuery.data || tenantsQuery.data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>У вас ще немає бренду</CardTitle>
          <CardDescription>
            Попросіть супер-адміністратора створити бренд і призначити вас власником.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!current) {
    return <p className="text-sm text-muted-foreground">Завантажую бренд…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("bpr.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("bpr.subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("bpr.new")}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isEmpty ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t("bpr.empty.title")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("bpr.empty.desc")}</p>
              <Button className="mt-4" onClick={() => setCreating(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t("bpr.new")}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("bpr.col.code")}</TableHead>
                  <TableHead>{t("bpr.col.type")}</TableHead>
                  <TableHead className="text-right">{t("bpr.col.value")}</TableHead>
                  <TableHead className="text-right">{t("bpr.col.used")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("bpr.col.expires")}</TableHead>
                  <TableHead>{t("bpr.col.status")}</TableHead>
                  <TableHead className="w-[100px] text-right">Дії</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promos.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-mono text-sm font-medium">
                        {p.code ?? "—"}
                      </div>
                      <div className="text-xs text-muted-foreground">{p.name}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {typeLabel[p.promo_type as PromoType] ?? p.promo_type}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatValue(p)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {p.times_used}
                      {p.usage_limit !== null && ` / ${p.usage_limit}`}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {p.ends_at ? format(new Date(p.ends_at), "dd MMM yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.is_active ? "default" : "outline"}>
                        {p.is_active ? "Активний" : "Вимкнено"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setEditing(p)}
                        aria-label="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleting(p)}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create / edit form */}
      <Sheet open={formOpen} onOpenChange={(open) => !open && closeForm()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{editing ? t("bpr.edit.title") : t("bpr.create.title")}</SheetTitle>
            <SheetDescription>{current.name}</SheetDescription>
          </SheetHeader>

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) {
                toast.error("Введіть назву");
                return;
              }
              if (editing) updateMutation.mutate();
              else createMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="p-code">{t("bpr.field.code")}</Label>
              <div className="flex gap-2">
                <Input
                  id="p-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  className="font-mono uppercase"
                  maxLength={32}
                  placeholder="SUMMER10"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCode(generateCode())}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {t("bpr.generate")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("bpr.field.code.hint")}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="p-name">{t("bpr.field.name")}</Label>
              <Input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
                placeholder="Літня знижка 10%"
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("bpr.field.type")}</Label>
              <Select value={promoType} onValueChange={(v) => setPromoType(v as PromoType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent_off">{t("bpr.type.percent")}</SelectItem>
                  <SelectItem value="fixed_off">{t("bpr.type.fixed")}</SelectItem>
                  <SelectItem value="free_shipping">{t("bpr.type.shipping")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {promoType !== "free_shipping" && (
              <div className="space-y-1.5">
                <Label htmlFor="p-value">
                  {promoType === "percent_off"
                    ? t("bpr.field.value.percent")
                    : t("bpr.field.value.fixed")}
                </Label>
                <Input
                  id="p-value"
                  type="number"
                  min={promoType === "percent_off" ? 1 : 1}
                  max={promoType === "percent_off" ? 100 : undefined}
                  step={promoType === "percent_off" ? 1 : 0.01}
                  value={value}
                  onChange={(e) => setValue(Number(e.target.value))}
                  required
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-min">{t("bpr.field.minOrder")}</Label>
                <Input
                  id="p-min"
                  type="number"
                  min={0}
                  step={0.01}
                  value={minOrderUah}
                  onChange={(e) => setMinOrderUah(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-usage">{t("bpr.field.usagePerCustomer")}</Label>
                <Input
                  id="p-usage"
                  type="number"
                  min={1}
                  value={usagePerCustomer}
                  onChange={(e) => setUsagePerCustomer(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="p-limit">{t("bpr.field.usageLimit")}</Label>
              <Input
                id="p-limit"
                type="number"
                min={0}
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value)}
                placeholder="Без обмеження"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-starts">{t("bpr.field.startsAt")}</Label>
                <Input
                  id="p-starts"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-ends">{t("bpr.field.endsAt")}</Label>
                <Input
                  id="p-ends"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label htmlFor="p-active" className="cursor-pointer">
                {t("bpr.field.active")}
              </Label>
              <Switch id="p-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={closeForm}>
                Скасувати
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "…" : editing ? "Зберегти" : t("bpr.new")}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bpr.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.code ?? deleting?.name} — {t("bpr.delete.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Скасувати</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "…" : t("bpr.deleted")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
