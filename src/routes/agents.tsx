import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Brain,
  Coins,
  Mail,
  Megaphone,
  Search,
  Shield,
  ShoppingCart,
  Sparkles,
  Tag,
  Truck,
  Users,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/MarketingShell";
import { useT, tStatic, type TKey } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";
import {
  AGENT_CATALOG,
  CATEGORY_ORDER,
  type AgentCategory,
  type AgentMeta,
} from "@/lib/acos/agentCatalog";
import { humanizeAgentId } from "@/lib/acos/agentLabels";

export const Route = createFileRoute("/agents")({
  head: () =>
    buildSeo({
      title: tStatic("ag.metaTitle"),
      description: tStatic("ag.metaDesc"),
      path: "/agents",
    }),
  component: Agents,
});

const ICON_MAP: Record<AgentMeta["icon"], typeof Bot> = {
  Users,
  Boxes,
  ShoppingCart,
  Search,
  Tag,
  Mail,
  Bot,
  Brain,
  Sparkles,
  Shield,
  Truck,
  Coins,
  Activity,
  Bell,
  BarChart3,
  Megaphone,
  Zap,
};

const CATEGORY_TONE: Record<AgentCategory, string> = {
  growth: "text-success border-success/30 bg-success/5",
  retention: "text-info border-info/30 bg-info/5",
  operations: "text-warning border-warning/30 bg-warning/5",
  communication: "text-primary border-primary/30 bg-primary/5",
  content_seo: "text-accent border-accent/30 bg-accent/5",
  analytics: "text-info border-info/30 bg-info/5",
  ai_quality: "text-primary border-primary/30 bg-primary/5",
  safety: "text-destructive border-destructive/30 bg-destructive/5",
};

const CATEGORY_LABEL: Record<AgentCategory, string> = {
  growth: "Зростання та продажі",
  retention: "Утримання клієнтів",
  operations: "Операції та склад",
  communication: "Комунікації",
  content_seo: "Контент і SEO",
  analytics: "Аналітика",
  ai_quality: "Якість AI",
  safety: "Безпека",
};

function Agents() {
  const { t } = useT();

  const grouped = useMemo(() => {
    const map = new Map<AgentCategory, AgentMeta[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const a of AGENT_CATALOG) {
      map.get(a.category)?.push(a);
    }
    return map;
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <MarketingHeader />
      <section className="border-b border-border bg-gradient-to-br from-primary/10 via-background to-background">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" /> {t("ag.badge")}
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {t("ag.title")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground">
            {t("ag.subtitle")}
          </p>
          <p className="mx-auto mt-4 text-sm text-muted-foreground">
            <strong className="text-foreground">{AGENT_CATALOG.length}</strong> помічників у{" "}
            {CATEGORY_ORDER.length} категоріях
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl space-y-12 px-4 py-16">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={cat} className="space-y-4">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={CATEGORY_TONE[cat]}>
                  {CATEGORY_LABEL[cat]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {items.length} {items.length === 1 ? "помічник" : "помічників"}
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {items.map((agent) => {
                  const Icon = ICON_MAP[agent.icon] ?? Bot;
                  const titleKey = `agc.${agent.i18nKey}.title` as TKey;
                  const whatKey = `agc.${agent.i18nKey}.what` as TKey;
                  const impactKey = `agc.${agent.i18nKey}.impact` as TKey;
                  const titleResolved = t(titleKey);
                  const title =
                    titleResolved === titleKey ? humanizeAgentId(agent.id) : titleResolved;
                  const whatResolved = t(whatKey);
                  const summary = whatResolved === whatKey ? "" : whatResolved;
                  const impactResolved = t(impactKey);
                  const impact = impactResolved === impactKey ? "" : impactResolved;

                  return (
                    <Card key={agent.id} className="border-border bg-card/60">
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-lg ${CATEGORY_TONE[cat]}`}
                          >
                            <Icon className="h-5 w-5" />
                          </div>
                          <CardTitle className="text-base">{title}</CardTitle>
                        </div>
                        {summary && (
                          <CardDescription className="mt-3 text-xs">{summary}</CardDescription>
                        )}
                      </CardHeader>
                      {impact && (
                        <CardContent>
                          <p className="text-sm font-medium text-primary">→ {impact}</p>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="pt-8 text-center">
          <Button asChild size="lg">
            <Link to="/signup">{t("ag.runOnStore")}</Link>
          </Button>
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}
