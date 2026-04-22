/**
 * Universal MARQ integration guide — adapts to ANY storefront stack.
 *
 * Three tracks:
 *   1. Universal HTML  — single <script> tag (Tilda, Webflow, Wix, raw HTML).
 *   2. React/Vite/Next  — copy-paste `marqMirror.ts` helper (Lovable/SPA apps that
 *      already write events to their own DB and want to mirror them to MARQ).
 *   3. WordPress/Shopify — same script tag but with platform-specific notes.
 *
 * The "Mirror SDK" track is what My Food Diary–style projects need: they keep
 * their own analytics intact and just dual-write the same payload to MARQ.
 */
import { useMemo, useState } from "react";
import { Check, Copy, Globe, Code2, ShoppingBag, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Props = { tenantSlug: string };

export function IntegrationGuide({ tenantSlug }: Props) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const ingestUrl = `${origin}/hooks/ingest`;
  const scriptSrc = `${origin}/track/${tenantSlug}/js`;

  const universalSnippet = `<!-- MARQ tracking — paste before </body> -->\n<script async src="${scriptSrc}"></script>`;

  const mirrorHelper = useMemo(
    () => `// src/lib/marqMirror.ts — fire-and-forget mirror to MARQ.
// Zero UI latency: uses sendBeacon when available.
const MARQ_INGEST = "${ingestUrl}";
const MARQ_TENANT = "${tenantSlug}";

const SID_KEY = "marq_sid";
const getSid = (): string => {
  if (typeof window === "undefined") return "ssr";
  try {
    let sid = localStorage.getItem(SID_KEY);
    if (!sid) {
      sid = crypto.randomUUID?.() ?? \`\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;
      localStorage.setItem(SID_KEY, sid);
    }
    return sid;
  } catch {
    return "anon";
  }
};

export type MarqMirrorInput = {
  event_type: string;
  product_id?: string | null;
  order_id?: string | null;
  user_id?: string | null;
  email?: string | null;
  name?: string | null;
  telegram_chat_id?: string | number | null;
  total_cents?: number;
  currency?: string;
  items?: Array<{ product_id?: string; product_name: string; quantity: number; unit_price_cents: number }>;
  metadata?: Record<string, unknown>;
};

export const mirrorToMarq = (input: MarqMirrorInput): void => {
  if (typeof window === "undefined") return;
  const customer =
    input.email || input.telegram_chat_id || input.user_id
      ? {
          email: input.email ?? undefined,
          name: input.name ?? undefined,
          telegram_chat_id: input.telegram_chat_id ?? undefined,
          user_id: input.user_id ?? undefined,
        }
      : undefined;

  const body = JSON.stringify({
    tenant_slug: MARQ_TENANT,
    type: input.event_type,
    session_id: getSid(),
    product_id: input.product_id ?? undefined,
    order_id: input.order_id ?? undefined,
    total_cents: input.total_cents,
    currency: input.currency,
    items: input.items,
    customer,
    payload: { ...(input.metadata ?? {}), url: location.href, referrer: document.referrer || null },
    created_at: new Date().toISOString(),
  });

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(MARQ_INGEST, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(MARQ_INGEST, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // never throws
  }
};
`,
    [ingestUrl, tenantSlug],
  );

  const acosPatch = `// src/lib/acos.ts — додай 1 import + 1 виклик усередині acos()
import { mirrorToMarq } from "./marqMirror";

// ...існуючий код acos() без змін, додай В САМИЙ КІНЕЦЬ функції
// (одразу після scheduleFlush()):

mirrorToMarq({
  event_type: input.event_type,
  product_id: input.product_id,
  order_id: input.order_id,
  user_id: cachedUserId,
  metadata: input.metadata,
  // якщо це покупка — передай також total_cents та email
  total_cents: typeof input.metadata?.total_cents === "number" ? input.metadata.total_cents : undefined,
  email: typeof input.metadata?.email === "string" ? input.metadata.email : undefined,
});
`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Підключення storefront до MARQ
        </CardTitle>
        <CardDescription className="text-xs">
          Обери трек залежно від твого стека. Усі варіанти ведуть до одного ingest-endpoint —
          MARQ-агенти автоматично адаптуються до того, що приходить.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="universal" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="universal" className="text-xs">
              <Globe className="mr-1.5 h-3.5 w-3.5" />
              Сайт або лендінг
            </TabsTrigger>
            <TabsTrigger value="mirror" className="text-xs">
              <Code2 className="mr-1.5 h-3.5 w-3.5" />
              Свій застосунок
            </TabsTrigger>
            <TabsTrigger value="platforms" className="text-xs">
              <ShoppingBag className="mr-1.5 h-3.5 w-3.5" />
              Shopify · WordPress
            </TabsTrigger>
          </TabsList>

          <TabsContent value="universal" className="space-y-3 pt-4">
            <p className="text-xs text-muted-foreground">
              Найпростіший варіант. Підходить для Tilda, Webflow, Wix, лендінгів та звичайних
              сайтів. Сам відстежує перегляди сторінок і продуктові картки. Для кошика й оплати
              додай ручні події через{" "}
              <code className="rounded bg-muted px-1">window.MARQ.track(тип, дані)</code>.
            </p>
            <Snippet code={universalSnippet} />
            <details className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs">
              <summary className="cursor-pointer font-medium">Як надсилати події вручну</summary>
              <Snippet
                small
                code={`MARQ.track('add_to_cart',     { product_id: 'P1', name: 'Tee', price_cents: 2400 });
MARQ.track('checkout_started',{ cart_value_cents: 4800, email: 'a@b.com' });
MARQ.track('purchase_completed', {
  order_id: 'ORD123', total_cents: 4800, email: 'a@b.com',
  items: [{ product_name: 'Tee', quantity: 2, unit_price_cents: 2400 }]
});`}
              />
            </details>
          </TabsContent>

          <TabsContent value="mirror" className="space-y-3 pt-4">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                Рекомендовано
              </Badge>
              <p className="text-xs text-muted-foreground">
                Для React, Vite або Next-застосунку, який уже зберігає події у власну базу. Дублюємо
                ті самі дані в MARQ через <code>sendBeacon</code> — без затримок інтерфейсу.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium">
                1. Створи файл <code className="rounded bg-muted px-1">src/lib/marqMirror.ts</code>:
              </p>
              <Snippet code={mirrorHelper} small maxH="max-h-72" />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium">2. Додай 1 рядок у свій трекер подій:</p>
              <Snippet code={acosPatch} small />
            </div>
            <div className="rounded-md border border-success/30 bg-success/10 p-3 text-xs text-success">
              ✅ Готово. Твоя власна аналітика працює як раніше. ШІ-помічники MARQ почнуть давати
              підказки приблизно через 5 хвилин.
            </div>
          </TabsContent>

          <TabsContent value="platforms" className="space-y-3 pt-4">
            <div className="space-y-2">
              <p className="text-xs font-medium">Shopify</p>
              <p className="text-xs text-muted-foreground">
                Online Store → Themes → Edit code → файл <code>theme.liquid</code> → встав цей рядок
                перед <code>&lt;/body&gt;</code>:
              </p>
              <Snippet code={universalSnippet} small />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium">WordPress / WooCommerce</p>
              <p className="text-xs text-muted-foreground">
                Встанови плагін <em>Insert Headers and Footers</em> → у поле «Footer Scripts» встав:
              </p>
              <Snippet code={universalSnippet} small />
            </div>
            <p className="text-xs text-muted-foreground">
              Скрипт фіксує покупку на сторінці подяки. Для серверної верифікації
              Shopify/WooCommerce скористайтеся вебхуком — конфігурація у розділі <em>Імпорт</em> →
              відповідний конектор.
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function Snippet({
  code,
  small = false,
  maxH = "",
}: {
  code: string;
  small?: boolean;
  maxH?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Скопійовано");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Не вдалося скопіювати");
    }
  };
  return (
    <div className="relative">
      <pre
        className={`overflow-x-auto rounded-md border border-border bg-muted/40 p-3 ${
          small ? "text-[11px]" : "text-xs"
        } leading-relaxed text-foreground ${maxH ? `${maxH} overflow-y-auto` : ""}`}
      >
        {code}
      </pre>
      <Button
        size="sm"
        variant="ghost"
        className="absolute right-1.5 top-1.5 h-7 px-2"
        onClick={copy}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
