/**
 * HandbookConnectors — UI-заглушки для майбутніх конекторів.
 * Поки кнопки disabled з підказкою "Скоро". Реальні OAuth/import-агенти
 * приїдуть наступним кроком (Iter 2). Картки повністю стилізовані як
 * mission-control панелі.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShoppingBag, Globe, Database, FileSpreadsheet, Sparkles, ArrowRight } from "lucide-react";
import { useT } from "@/lib/i18n";

const CONNECTORS = [
  {
    id: "shopify",
    icon: ShoppingBag,
    nameKey: "hb.conn.shopify.name",
    descKey: "hb.conn.shopify.desc",
    statusKey: "hb.conn.soon",
    accent: "from-emerald-500/20 to-emerald-500/5",
    iconColor: "text-emerald-400",
  },
  {
    id: "woocommerce",
    icon: Globe,
    nameKey: "hb.conn.woo.name",
    descKey: "hb.conn.woo.desc",
    statusKey: "hb.conn.soon",
    accent: "from-purple-500/20 to-purple-500/5",
    iconColor: "text-purple-400",
  },
  {
    id: "postgres",
    icon: Database,
    nameKey: "hb.conn.pg.name",
    descKey: "hb.conn.pg.desc",
    statusKey: "hb.conn.soon",
    accent: "from-sky-500/20 to-sky-500/5",
    iconColor: "text-sky-400",
  },
  {
    id: "csv",
    icon: FileSpreadsheet,
    nameKey: "hb.conn.csv.name",
    descKey: "hb.conn.csv.desc",
    statusKey: "hb.conn.available",
    accent: "from-amber-500/20 to-amber-500/5",
    iconColor: "text-amber-400",
    available: true,
  },
] as const;

export function HandbookConnectors() {
  const { t } = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {CONNECTORS.map((c) => {
        const Icon = c.icon;
        const available = "available" in c && c.available;
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
                <Badge
                  variant={available ? "default" : "outline"}
                  className="text-[10px] uppercase tracking-wider"
                >
                  {available ? t("hb.conn.available" as never) : t("hb.conn.soon" as never)}
                </Badge>
              </div>
              <CardTitle className="text-base">{t(c.nameKey as never)}</CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                {t(c.descKey as never)}
              </CardDescription>
            </CardHeader>
            <CardContent className="relative">
              <Button
                size="sm"
                variant={available ? "default" : "secondary"}
                disabled={!available}
                className="w-full"
              >
                {available ? (
                  <>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    {t("hb.conn.connectNow" as never)}
                  </>
                ) : (
                  <>
                    {t("hb.conn.notifyMe" as never)}
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
