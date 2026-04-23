/**
 * HandbookConnectors — каталог конекторів у довіднику.
 *
 * Раніше це були UI-заглушки з disabled-кнопками "Скоро". Тепер усі картки
 * ведуть користувача до справжньої сторінки `/brand/integrations`, де є
 * IntegrationWizard з реальними OAuth/CSV-флоу. Картки лишились як
 * красива презентація доступних джерел, але кнопки тепер робочі.
 */
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShoppingBag, Globe, Database, FileSpreadsheet, ArrowRight, Plug } from "lucide-react";
import { useT } from "@/lib/i18n";

const CONNECTORS = [
  {
    id: "shopify",
    icon: ShoppingBag,
    nameKey: "hb.conn.shopify.name",
    descKey: "hb.conn.shopify.desc",
    accent: "from-emerald-500/20 to-emerald-500/5",
    iconColor: "text-emerald-400",
    available: true,
  },
  {
    id: "woocommerce",
    icon: Globe,
    nameKey: "hb.conn.woo.name",
    descKey: "hb.conn.woo.desc",
    accent: "from-purple-500/20 to-purple-500/5",
    iconColor: "text-purple-400",
    available: true,
  },
  {
    id: "postgres",
    icon: Database,
    nameKey: "hb.conn.pg.name",
    descKey: "hb.conn.pg.desc",
    accent: "from-sky-500/20 to-sky-500/5",
    iconColor: "text-sky-400",
    available: true,
  },
  {
    id: "csv",
    icon: FileSpreadsheet,
    nameKey: "hb.conn.csv.name",
    descKey: "hb.conn.csv.desc",
    accent: "from-amber-500/20 to-amber-500/5",
    iconColor: "text-amber-400",
    available: true,
  },
] as const;

export function HandbookConnectors() {
  const { t } = useT();
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {CONNECTORS.map((c) => {
          const Icon = c.icon;
          return (
            <Card
              key={c.id}
              className="relative overflow-hidden border-border/60 bg-card/40 backdrop-blur"
            >
              <div
                className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.accent} opacity-50`}
              />
              <CardHeader className="relative">
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-lg bg-background/60 ${c.iconColor}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <Badge variant="default" className="text-[10px] uppercase tracking-wider">
                    {t("hb.conn.available" as never)}
                  </Badge>
                </div>
                <CardTitle className="text-base">{t(c.nameKey as never)}</CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  {t(c.descKey as never)}
                </CardDescription>
              </CardHeader>
              <CardContent className="relative">
                <Button asChild size="sm" variant="default" className="w-full">
                  <Link to="/brand/integrations">
                    <Plug className="mr-1.5 h-3.5 w-3.5" />
                    {t("hb.conn.connectNow" as never)}
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-dashed bg-muted/20">
        <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            Усі підключення керуються в одному хабі: ключі, синхронізації, історія імпортів.
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/brand/integrations">
              Відкрити хаб інтеграцій
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
