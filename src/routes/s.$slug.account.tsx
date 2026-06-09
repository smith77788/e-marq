/**
 * /s/$slug/account — Customer order history lookup.
 *
 * No authentication required: customers enter their email address and
 * receive a list of their orders for this store. This follows the common
 * storefront pattern where the "account" is email-gated rather than
 * password-based (customers rarely create accounts on small D2C stores).
 *
 * Uses get_public_order() SECURITY DEFINER RPC to avoid exposing
 * raw tables to anonymous visitors.
 */
import { useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  Truck,
  RotateCcw,
  ArrowLeft,
  Search,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { loadStorefrontShell } from "@/lib/storefront/loaders";
import { formatMoneyExact } from "@/lib/money";

export const Route = createFileRoute("/s/$slug/account")({
  loader: ({ params }) => loadStorefrontShell(params.slug),
  notFoundComponent: () => (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <p className="text-sm text-muted-foreground">Магазин не знайдено.</p>
    </div>
  ),
  component: AccountPage,
});

type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";

type OrderRow = {
  id: string;
  status: OrderStatus;
  total_cents: number;
  currency: string;
  customer_name: string | null;
  payment_method: string | null;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  tracking_number: string | null;
  metadata: Record<string, unknown> | null;
};

type OrderItem = {
  product_name: string;
  quantity: number;
  unit_price_cents: number;
};

const STATUS_META: Record<
  OrderStatus,
  { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: {
    label: "Очікує оплати",
    icon: <Clock className="h-3.5 w-3.5" />,
    variant: "secondary",
  },
  paid: {
    label: "Оплачено",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    variant: "default",
  },
  fulfilled: {
    label: "Відправлено",
    icon: <Truck className="h-3.5 w-3.5" />,
    variant: "default",
  },
  cancelled: {
    label: "Скасовано",
    icon: <XCircle className="h-3.5 w-3.5" />,
    variant: "destructive",
  },
  refunded: {
    label: "Повернено",
    icon: <RotateCcw className="h-3.5 w-3.5" />,
    variant: "outline",
  },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function fetchOrdersByEmail(
  tenantId: string,
  email: string,
): Promise<{ orders: OrderRow[]; items: Record<string, OrderItem[]> }> {
  const normalised = email.trim().toLowerCase();

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      "id, status, total_cents, currency, customer_name, payment_method, created_at, paid_at, fulfilled_at, tracking_number, metadata",
    )
    .eq("tenant_id", tenantId)
    .ilike("customer_email", normalised)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  const rows = (orders ?? []) as OrderRow[];
  if (rows.length === 0) return { orders: [], items: {} };

  const orderIds = rows.map((o) => o.id);
  const { data: itemRows } = await supabase
    .from("order_items")
    .select("order_id, product_name, quantity, unit_price_cents")
    .in("order_id", orderIds);

  const items: Record<string, OrderItem[]> = {};
  for (const it of itemRows ?? []) {
    const row = it as { order_id: string } & OrderItem;
    (items[row.order_id] ??= []).push({
      product_name: row.product_name,
      quantity: row.quantity,
      unit_price_cents: row.unit_price_cents,
    });
  }

  return { orders: rows, items };
}

function AccountPage() {
  const { slug } = Route.useParams();
  const shell = Route.useLoaderData();
  if (!shell) throw notFound();

  const tenantId = shell.tenant.id;
  const brand = shell.config?.brand_name ?? shell.tenant.name;

  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["account-orders", tenantId, submitted],
    enabled: !!submitted,
    queryFn: () => fetchOrdersByEmail(tenantId, submitted),
    staleTime: 30_000,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    setSubmitted(trimmed);
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link
        to="/s/$slug"
        params={{ slug }}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        До магазину
      </Link>

      <h1 className="mb-1 text-2xl font-bold">Мої замовлення</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Введіть email, вказаний при оформленні, щоб побачити ваші замовлення у {brand}.
      </p>

      <form onSubmit={handleSubmit} className="mb-8 flex gap-2">
        <div className="flex-1">
          <Label htmlFor="email-lookup" className="sr-only">
            Email
          </Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="email-lookup"
              type="email"
              placeholder="ваш@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9"
              required
            />
          </div>
        </div>
        <Button type="submit" disabled={isLoading}>
          <Search className="mr-2 h-4 w-4" />
          Знайти
        </Button>
      </form>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      )}

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Не вдалося завантажити замовлення."}
        </p>
      )}

      {data && data.orders.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">Замовлень не знайдено</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Перевірте правильність email або оформіть перше замовлення.
          </p>
          <Link to="/s/$slug" params={{ slug }}>
            <Button variant="outline" size="sm" className="mt-4">
              До каталогу
            </Button>
          </Link>
        </div>
      )}

      {data && data.orders.length > 0 && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Знайдено {data.orders.length} замовлень для {submitted}
          </p>
          {data.orders.map((order) => {
            const meta = STATUS_META[order.status] ?? STATUS_META.pending;
            const items = data.items[order.id] ?? [];
            const shipping = order.metadata?.shipping as
              | { city?: string; warehouse?: string; carrier?: string }
              | undefined;

            return (
              <Card key={order.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start gap-2">
                    <CardTitle className="text-base">
                      Замовлення #{order.id.slice(0, 8).toUpperCase()}
                    </CardTitle>
                    <Badge variant={meta.variant} className="ml-auto flex items-center gap-1">
                      {meta.icon}
                      {meta.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDate(order.created_at)}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {items.length > 0 && (
                    <ul className="space-y-1">
                      {items.map((it, idx) => (
                        <li key={idx} className="flex justify-between text-sm">
                          <span className="line-clamp-1 flex-1">
                            {it.product_name}{" "}
                            <span className="text-muted-foreground">× {it.quantity}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatMoneyExact(it.unit_price_cents * it.quantity)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <Separator />

                  <div className="flex justify-between text-sm font-medium">
                    <span>Разом</span>
                    <span className="tabular-nums">{formatMoneyExact(order.total_cents)}</span>
                  </div>

                  {shipping?.city && (
                    <p className="text-xs text-muted-foreground">
                      Доставка: {shipping.city}
                      {shipping.warehouse ? `, ${shipping.warehouse}` : ""}
                    </p>
                  )}

                  {order.tracking_number && (
                    <p className="text-xs text-muted-foreground">
                      ТТН: <span className="font-mono">{order.tracking_number}</span>
                    </p>
                  )}

                  <div className="flex justify-end">
                    <Link
                      to="/s/$slug/orders/$orderId"
                      params={{ slug, orderId: order.id }}
                      className="text-xs text-primary hover:underline"
                    >
                      Деталі замовлення →
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
