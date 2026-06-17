import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Clock, XCircle, ArrowLeft, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { formatMoneyExact } from "@/lib/money";

type OrderRow = {
  id: string;
  status: "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
  payment_method: string;
  payment_ref: string | null;
  total_cents: number;
  currency: string;
  customer_email: string | null;
  customer_name: string | null;
  created_at: string;
  paid_at: string | null;
  tenant_id: string;
};

type OrderItem = {
  id: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
};

type PaymentsConfig = {
  manual_instructions?: string;
  manual_contact?: string;
};

type OrderSearch = { tok?: string };

async function loadOrder(slug: string, orderId: string, tok: string | undefined) {
  if (!tok) throw notFound();

  const { data, error } = await supabase.rpc("get_public_order_v2", {
    _order_id: orderId,
    _access_token: tok,
  });
  if (error) throw error;
  if (!data) throw notFound();

  const payload = data as {
    order: OrderRow;
    items: OrderItem[];
    tenant: { id: string; slug: string; name: string } | null;
    config: { brand_name: string; features: { payments?: PaymentsConfig } } | null;
  };

  if (!payload.tenant || payload.tenant.slug !== slug) {
    throw notFound();
  }

  const features = payload.config?.features ?? {};
  const payments = features.payments ?? {};

  return {
    tenant: payload.tenant,
    order: payload.order,
    items: payload.items,
    brand: payload.config?.brand_name ?? payload.tenant.name,
    payments,
  };
}

export const Route = createFileRoute("/s/$slug/orders/$orderId")({
  validateSearch: (s: Record<string, unknown>): OrderSearch => ({
    tok: typeof s.tok === "string" ? s.tok : undefined,
  }),
  loaderDeps: ({ search }) => ({ tok: search.tok }),
  loader: ({ params, deps }) => loadOrder(params.slug, params.orderId, deps.tok),
  head: ({ loaderData }) => {
    const brand = loaderData?.brand ?? "Магазин";
    const orderShort = loaderData?.order.id.slice(0, 8) ?? "";
    return {
      meta: [{ title: `Замовлення #${orderShort} — ${brand}` }, { name: "robots", content: "noindex" }],
    };
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-foreground">Замовлення не знайдено</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Це замовлення не існує або було видалено.
        </p>
      </div>
    </div>
  ),
  errorComponent: ({ error }: { error: Error }) => (
    <div className="flex min-h-screen items-center justify-center px-4">
      <p className="text-sm text-destructive">Помилка завантаження: {error.message}</p>
    </div>
  ),
  component: OrderStatusPage,
});

function OrderStatusPage() {
  const { slug, orderId } = Route.useParams();
  const initial = Route.useLoaderData();
  const search = Route.useSearch();

  const { data } = useQuery<Awaited<ReturnType<typeof loadOrder>>>({
    queryKey: ["order", slug, orderId, search.tok],
    queryFn: () => loadOrder(slug, orderId, search.tok),
    initialData: initial,
    refetchInterval: initial.order.status === "pending" ? 10_000 : false,
  });

  const { order, items, brand, payments, tenant } = data;
  const isPending = order.status === "pending";
  const isPaid = order.status === "paid" || order.status === "fulfilled";
  const isCancelled = order.status === "cancelled" || order.status === "refunded";
  const isManual = order.payment_method === "manual";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight text-foreground">{brand}</h1>
          <Link
            to="/s/$slug"
            params={{ slug }}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Продовжити покупки
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-xl">Замовлення #{order.id.slice(0, 8)}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Оформлено {new Date(order.created_at).toLocaleString("uk-UA")}
              </p>
            </div>
            <StatusBadge status={order.status} />
          </CardHeader>
          <CardContent className="space-y-4">
            {isPending && isManual && (
              <ManualPaymentInstructions
                orderId={order.id}
                totalCents={order.total_cents}
                instructions={payments.manual_instructions}
                contact={payments.manual_contact}
              />
            )}
            {isPaid && (
              <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="font-medium text-foreground">Оплату підтверджено</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {order.paid_at
                      ? `Підтверджено ${new Date(order.paid_at).toLocaleString("uk-UA")}`
                      : "Ваше замовлення обробляється."}
                  </p>
                </div>
              </div>
            )}
            {isCancelled && (
              <div className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="font-medium text-foreground">
                    {order.status === "refunded" ? "Кошти повернуто" : "Замовлення скасовано"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Зверніться до продавця, якщо є питання.
                  </p>
                </div>
              </div>
            )}

            <Separator />

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Товари</h3>
              <ul className="space-y-1 text-sm">
                {items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-3">
                    <span className="line-clamp-1 text-foreground">
                      {item.product_name} × {item.quantity}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatMoneyExact(item.unit_price_cents * item.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between border-t pt-2 text-sm font-semibold">
                <span>Разом</span>
                <span>{formatMoneyExact(order.total_cents)}</span>
              </div>
            </div>

            <Separator />

            <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-xs">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="text-foreground">{order.customer_email ?? "—"}</dd>
              {order.customer_name && (
                <>
                  <dt className="text-muted-foreground">Імʼя</dt>
                  <dd className="text-foreground">{order.customer_name}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Оплата</dt>
              <dd className="text-foreground">
                {PAYMENT_METHOD_LABEL[order.payment_method] ?? order.payment_method}
              </dd>
              {order.payment_ref && (
                <>
                  <dt className="text-muted-foreground">Референс</dt>
                  <dd className="font-mono text-foreground">{order.payment_ref}</dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Powered by MARQ · /{tenant.slug}
        </p>
      </main>
    </div>
  );
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  manual: "Банківський переказ",
  stripe_card: "Картка (Stripe)",
  liqpay: "LiqPay · картка",
  wayforpay: "WayForPay · картка",
  monobank: "Monobank",
};

function StatusBadge({ status }: { status: OrderRow["status"] }) {
  const map: Record<
    OrderRow["status"],
    { label: string; variant: "default" | "outline" | "secondary" | "destructive" }
  > = {
    pending: { label: "Очікує оплати", variant: "secondary" },
    paid: { label: "Оплачено", variant: "default" },
    fulfilled: { label: "Відправлено", variant: "outline" },
    cancelled: { label: "Скасовано", variant: "destructive" },
    refunded: { label: "Повернено", variant: "outline" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

function ManualPaymentInstructions({
  orderId,
  totalCents,
  instructions,
  contact,
}: {
  orderId: string;
  totalCents: number;
  instructions?: string;
  contact?: string;
}) {
  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold text-foreground">Очікує оплати</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Сплатіть {formatMoneyExact(totalCents)} за реквізитами нижче. Вкажіть
            номер замовлення <span className="font-mono font-medium">{orderId.slice(0, 8)}</span> у
            призначенні платежу.
          </p>
        </div>
      </div>
      {instructions && (
        <div className="rounded bg-background p-3 text-xs">
          <pre className="whitespace-pre-wrap font-mono text-foreground">{instructions}</pre>
        </div>
      )}
      {contact && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Mail className="h-3 w-3" />
          <span>
            Питання? Звертайтесь:{" "}
            <span className="font-medium text-foreground">{contact}</span>
          </span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Після оплати продавець підтвердить замовлення вручну. Сторінка оновлюється автоматично.
      </p>
    </div>
  );
}
