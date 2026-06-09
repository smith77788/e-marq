/**
 * Brand → Orders. Owner-facing order management.
 * Lists orders, filters by status, opens a Sheet with full order details
 * and quick status transitions (mark paid, mark fulfilled, cancel, refund).
 *
 * Tenant scoping: ?tenant=<id> search param, auto-selected from the user's
 * first available tenant on initial load. RLS enforces that only members
 * of the tenant (admin/owner) can read/update orders.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { CheckCircle2, Package, Search, ShoppingBag, Truck, X } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useT } from "@/lib/i18n";
import { formatMoneyExact } from "@/lib/money";
import { sendOrderStatusEmail } from "@/lib/email/client";
import { OrderTelegramChat } from "@/components/owner/OrderTelegramChat";

type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";

type OrderRow = {
  id: string;
  tenant_id: string;
  customer_email: string | null;
  customer_name: string | null;
  customer_user_id: string | null;
  status: OrderStatus;
  total_cents: number;
  currency: string;
  payment_method: string;
  payment_ref: string | null;
  paid_at: string | null;
  shipping_address: Record<string, unknown> | null;
  shipping_method: string | null;
  shipping_cost_cents: number;
  tracking_number: string | null;
  tracking_url: string | null;
  fulfilled_at: string | null;
  notes: string | null;
  created_at: string;
};

type OrderItem = {
  id: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
};

type Search = { tenant?: string };
type Filter = "all" | "pending" | "paid" | "fulfilled" | "cancelled";

export const Route = createFileRoute("/_authenticated/brand/orders")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: BrandOrdersPage,
});

const STATUS_VARIANT: Record<OrderStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  paid: "secondary",
  fulfilled: "default",
  cancelled: "destructive",
  refunded: "destructive",
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  manual: "Банківський переказ",
  stripe_card: "Stripe",
  liqpay: "LiqPay",
  wayforpay: "WayForPay",
  monobank: "Monobank",
};

function BrandOrdersPage() {
  const { tenant: tenantId } = useSearch({ from: "/_authenticated/brand/orders" });
  const { user, loading: authLoading } = useAuth();
  const {
    tenants,
    current,
    currentTenantId,
    setCurrentTenantId,
    loading: tenantsLoading,
  } = useTenantContext();
  const loading = authLoading || tenantsLoading;
  const { t } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const tenantsQuery = useQuery({
    queryKey: ["my-tenants-rpc", user?.id],
    enabled: !!user,
    initialData: tenants.map((tenant) => ({
      id: tenant.tenant_id,
      name: tenant.tenant_name,
      slug: tenant.tenant_slug,
      status: tenant.status,
    })),
    queryFn: async () =>
      tenants.map((tenant) => ({
        id: tenant.tenant_id,
        name: tenant.tenant_name,
        slug: tenant.tenant_slug,
        status: tenant.status,
      })),
  });

  const effectiveTenantId =
    tenantId ?? currentTenantId ?? current?.tenant_id ?? tenantsQuery.data?.[0]?.id ?? null;

  useEffect(() => {
    if (!effectiveTenantId) return;
    if (tenantId !== effectiveTenantId) {
      void navigate({
        to: "/brand/orders",
        search: { tenant: effectiveTenantId },
        replace: true,
      });
      return;
    }
    if (currentTenantId !== effectiveTenantId) {
      setCurrentTenantId(effectiveTenantId);
    }
  }, [tenantId, effectiveTenantId, currentTenantId, navigate, setCurrentTenantId]);

  const currentItem = tenantsQuery.data?.find((tt) => tt.id === effectiveTenantId);

  const ordersQuery = useQuery({
    queryKey: ["brand-orders", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, tenant_id, customer_email, customer_name, customer_user_id, status, total_cents, currency, payment_method, payment_ref, paid_at, shipping_address, shipping_method, shipping_cost_cents, tracking_number, tracking_url, fulfilled_at, notes, created_at",
        )
        .eq("tenant_id", effectiveTenantId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });

  const [opened, setOpened] = useState<OrderRow | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const itemsQuery = useQuery({
    queryKey: ["brand-order-items", opened?.id],
    enabled: !!opened,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_items")
        .select("id, product_name, quantity, unit_price_cents")
        .eq("order_id", opened!.id);
      if (error) throw error;
      return (data ?? []) as OrderItem[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["brand-orders", effectiveTenantId] });
  };

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OrderStatus }) => {
      const patch: {
        status: OrderStatus;
        paid_at?: string;
        fulfilled_at?: string;
      } = { status };
      if (status === "paid" && !opened?.paid_at) {
        patch.paid_at = new Date().toISOString();
      }
      if (status === "fulfilled") {
        patch.fulfilled_at = new Date().toISOString();
      }
      const { error } = await supabase.from("orders").update(patch).eq("id", id);
      if (error) throw error;
      if (
        status === "paid" ||
        status === "fulfilled" ||
        status === "cancelled" ||
        status === "refunded"
      ) {
        void sendOrderStatusEmail(id, status);
      }
    },
    onSuccess: (_, vars) => {
      toast.success(t("bo.changed"));
      setOpened((o) => (o && o.id === vars.id ? { ...o, status: vars.status } : o));
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const list = ordersQuery.data ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((o) => {
      if (filter !== "all" && o.status !== filter) return false;
      if (!q) return true;
      return (
        (o.customer_email ?? "").toLowerCase().includes(q) ||
        (o.customer_name ?? "").toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q)
      );
    });
  }, [ordersQuery.data, search, filter]);

  if (loading) return <PageSkeleton blocks={2} />;

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

  if (!currentItem) {
    return <p className="text-sm text-muted-foreground">Завантажую бренд…</p>;
  }

  const orders = ordersQuery.data ?? [];
  const isEmpty = !ordersQuery.isLoading && orders.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("bo.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("bo.subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="space-y-3 pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("bo.search")}
                className="h-9 pl-8 text-sm"
              />
            </div>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList className="h-9">
                <TabsTrigger value="all" className="text-xs">
                  {t("bo.tab.all")}
                </TabsTrigger>
                <TabsTrigger value="pending" className="text-xs">
                  {t("bo.tab.pending")}
                </TabsTrigger>
                <TabsTrigger value="paid" className="text-xs">
                  {t("bo.tab.paid")}
                </TabsTrigger>
                <TabsTrigger value="fulfilled" className="text-xs">
                  {t("bo.tab.fulfilled")}
                </TabsTrigger>
                <TabsTrigger value="cancelled" className="text-xs">
                  {t("bo.tab.cancelled")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {ordersQuery.isLoading ? (
            <TableSkeleton rows={6} columns={6} />
          ) : isEmpty ? (
            <EmptyState
              variant="inline"
              icon={ShoppingBag}
              title={t("bo.empty.title")}
              description={t("bo.empty.desc")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("bo.col.number")}</TableHead>
                    <TableHead>{t("bo.col.customer")}</TableHead>
                    <TableHead className="text-right">{t("bo.col.total")}</TableHead>
                    <TableHead>{t("bo.col.status")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("bo.col.payment")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("bo.col.date")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <TableRow
                      key={o.id}
                      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setOpened(o)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Відкрити замовлення #${o.id.slice(0, 8)}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpened(o);
                        }
                      }}
                    >
                      <TableCell className="font-mono text-xs">#{o.id.slice(0, 8)}</TableCell>
                      <TableCell>
                        <div className="text-sm font-medium text-foreground">
                          {o.customer_name ?? "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {o.customer_email ?? ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoneyExact(o.total_cents)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[o.status]}>
                          {t(`bo.status.${o.status}` as never)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                        {PAYMENT_METHOD_LABEL[o.payment_method] ?? o.payment_method}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                        {format(new Date(o.created_at), "dd MMM, HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail sheet */}
      <Sheet open={!!opened} onOpenChange={(open) => !open && setOpened(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {opened && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {t("bo.detail.title")} #{opened.id.slice(0, 8)}
                </SheetTitle>
                <SheetDescription>
                  {format(new Date(opened.created_at), "dd MMM yyyy, HH:mm")} ·{" "}
                  <Badge variant={STATUS_VARIANT[opened.status]} className="ml-1">
                    {t(`bo.status.${opened.status}` as never)}
                  </Badge>
                </SheetDescription>
              </SheetHeader>

              {/* Action buttons */}
              <div className="mt-6 flex flex-wrap gap-2">
                {opened.status === "pending" && (
                  <Button
                    size="sm"
                    onClick={() => statusMutation.mutate({ id: opened.id, status: "paid" })}
                    disabled={statusMutation.isPending}
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    {t("bo.action.markPaid")}
                  </Button>
                )}
                {opened.status === "paid" && (
                  <Button
                    size="sm"
                    onClick={() => statusMutation.mutate({ id: opened.id, status: "fulfilled" })}
                    disabled={statusMutation.isPending}
                  >
                    <Truck className="mr-1.5 h-3.5 w-3.5" />
                    {t("bo.action.fulfill")}
                  </Button>
                )}
                {(opened.status === "pending" || opened.status === "paid") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => statusMutation.mutate({ id: opened.id, status: "cancelled" })}
                    disabled={statusMutation.isPending}
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    {t("bo.action.cancel")}
                  </Button>
                )}
                {opened.status === "fulfilled" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => statusMutation.mutate({ id: opened.id, status: "refunded" })}
                    disabled={statusMutation.isPending}
                  >
                    {t("bo.action.refund")}
                  </Button>
                )}
              </div>

              <Separator className="my-6" />

              {/* Items */}
              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Package className="h-3.5 w-3.5" />
                  {t("bo.detail.items")}
                </h3>
                <div className="rounded-md border border-border">
                  {itemsQuery.isLoading ? (
                    <p className="px-3 py-4 text-xs text-muted-foreground">…</p>
                  ) : (itemsQuery.data ?? []).length === 0 ? (
                    <p className="px-3 py-4 text-xs text-muted-foreground">—</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {(itemsQuery.data ?? []).map((it) => (
                        <div
                          key={it.id}
                          className="flex items-center justify-between px-3 py-2 text-sm"
                        >
                          <span className="flex-1 truncate">
                            {it.product_name}{" "}
                            <span className="text-muted-foreground">× {it.quantity}</span>
                          </span>
                          <span className="tabular-nums font-medium">
                            {formatMoneyExact(it.unit_price_cents * it.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between pt-2 text-sm">
                  <span className="text-muted-foreground">
                    {t("bo.detail.shipping")}: {formatMoneyExact(opened.shipping_cost_cents)}
                  </span>
                  <span className="text-base font-bold">
                    {formatMoneyExact(opened.total_cents)}
                  </span>
                </div>
              </section>

              <Separator className="my-6" />

              {/* Contact + shipping */}
              <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("bo.detail.contact")}
                  </h4>
                  <p className="mt-1 text-sm text-foreground">{opened.customer_name ?? "—"}</p>
                  <p className="text-sm text-muted-foreground">{opened.customer_email ?? "—"}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("bo.detail.payment")}
                  </h4>
                  <p className="mt-1 text-sm text-foreground">
                    {PAYMENT_METHOD_LABEL[opened.payment_method] ?? opened.payment_method}
                  </p>
                  {opened.payment_ref && (
                    <p className="text-xs text-muted-foreground">{opened.payment_ref}</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("bo.detail.shipping")}
                  </h4>
                  {opened.shipping_method && (
                    <p className="mt-1 text-sm text-foreground">{opened.shipping_method}</p>
                  )}
                  {opened.shipping_address ? (
                    <pre className="mt-1 whitespace-pre-wrap rounded-md bg-muted p-2 text-xs text-muted-foreground">
                      {JSON.stringify(opened.shipping_address, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                  {opened.tracking_number && (
                    <p className="mt-2 text-xs">
                      <span className="text-muted-foreground">TTN:</span>{" "}
                      {opened.tracking_url ? (
                        <a
                          href={opened.tracking_url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-primary hover:underline"
                        >
                          {opened.tracking_number}
                        </a>
                      ) : (
                        <span className="font-mono">{opened.tracking_number}</span>
                      )}
                    </p>
                  )}
                </div>
              </section>

              {opened.notes && (
                <>
                  <Separator className="my-6" />
                  <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Нотатки
                    </h4>
                    <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">
                      {opened.notes}
                    </p>
                  </section>
                </>
              )}

              <Separator className="my-6" />
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Telegram-чат з клієнтом
                </h4>
                <OrderTelegramChat
                  orderId={opened.id}
                  tenantId={opened.tenant_id}
                  customerEmail={opened.customer_email}
                  customerUserId={opened.customer_user_id}
                />
              </section>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
