import { useState } from "react";
import { Check, Copy, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { MSG } from "@/lib/glossary";

type Props = { tenantSlug: string };

export function TrackingSnippet({ tenantSlug }: Props) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const snippet = `<!-- MARQ — лічильник подій. Встав перед </body> -->\n<script async src="${origin}/track/${tenantSlug}.js"></script>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      toast.success(MSG.copied);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(MSG.errCopy);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Code2 className="h-4 w-4 text-primary" />
          Лічильник подій для вашого сайту
        </CardTitle>
        <CardDescription className="text-xs">
          Встав цей рядок на свій сайт — і система почне бачити, що роблять відвідувачі: перегляди,
          додавання у кошик, покупки. Без нього ШІ-помічники працюють лише на старих даних. Доступна
          команда <code className="rounded bg-muted px-1 text-[11px]">MARQ.track(тип, дані)</code>{" "}
          для кошика та оформлення замовлення.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-foreground">
          {snippet}
        </pre>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? (
              <Check className="mr-1.5 h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {copied ? "Скопійовано" : "Скопіювати код"}
          </Button>
        </div>
        <details className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-foreground">
            Як надсилати події вручну (приклади)
          </summary>
          <pre className="mt-2 overflow-x-auto text-[11px] text-muted-foreground">
            {`MARQ.track('add_to_cart',     { product_id: 'P1', name: 'Футболка', price_cents: 2400 });
MARQ.track('checkout_started',{ cart_value_cents: 4800, product_names: ['Футболка','Кепка'], email: 'a@b.com' });
MARQ.track('purchase_completed', { order_id: 'ORD123', total_cents: 4800, email: 'a@b.com' });`}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}
