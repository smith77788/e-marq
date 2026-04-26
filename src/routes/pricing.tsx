import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/MarketingShell";
import { useT, tStatic } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/pricing")({
  head: () =>
    buildSeo({
      title: tStatic("pr.metaTitle"),
      description: tStatic("pr.metaDesc"),
      path: "/pricing",
    }),
  component: Pricing,
});

type PlanCard = {
  name: string;
  price: string;
  priceUsd: string;
  cadence: string;
  desc: string;
  features: string[];
  cta: string;
  ctaTo: "/signup" | "/contact";
  highlight: boolean;
};

function Pricing() {
  const { t } = useT();

  // Чотирирівнева структура: Free → Starter → Growth → Scale
  // USD — індикативно (40 ₴ = $1) для міжнародних відвідувачів.
  const plans: PlanCard[] = [
    {
      name: "Free",
      price: "0 ₴",
      priceUsd: "$0",
      cadence: "назавжди",
      desc: "Старт для малого бізнесу: базові агенти, що вже приносять користь з першого дня.",
      features: [
        "8 базових ШІ-агентів (відновлення кошика, попередження про залишки, ранкова зведення, anti-fraud)",
        "До 50 товарів та 100 замовлень/міс",
        "1 учасник команди",
        "Telegram-бот власника + email-сповіщення",
      ],
      cta: "Почати безкоштовно",
      ctaTo: "/signup",
      highlight: false,
    },
    {
      name: "Starter",
      price: "1 199 ₴",
      priceUsd: "≈ $30",
      cadence: "за бренд / місяць",
      desc: "Для бренду, що почав рости. Додає аналітику, AOV-оптимізацію та broadcast-розсилки.",
      features: [
        "23 ШІ-агенти (Free + AOV, churn, LTV, attribution, cohorts, broadcasts)",
        "До 300 товарів та 1 000 замовлень/міс",
        "5 учасників команди",
        "Розширена аналітика (cohort, attribution, funnel)",
      ],
      cta: "Почати з Starter",
      ctaTo: "/signup",
      highlight: false,
    },
    {
      name: "Growth",
      price: "3 999 ₴",
      priceUsd: "≈ $100",
      cadence: "за бренд / місяць",
      desc: "Повна оптимізація доходу: ціни, SEO, лояльність, прогнози інвентаря.",
      features: [
        "47 ШІ-агентів (Starter + ціновий оптимізатор, SEO-loop, лояльність, VIP)",
        "До 3 000 товарів та 10 000 замовлень/міс",
        "15 учасників команди",
        "Programmatic SEO, predictive pricing, bundle recommender",
      ],
      cta: "Перейти на Growth",
      ctaTo: "/signup",
      highlight: true,
    },
    {
      name: "Scale",
      price: "11 999 ₴",
      priceUsd: "≈ $300",
      cadence: "за бренд / місяць",
      desc: "Усі 58 агентів + meta-навчання, де система оптимізує саму себе.",
      features: [
        "Усі ШІ-агенти + AI-quality meta-loops (memory feedback, learning loop)",
        "Без обмежень на товари, замовлення, клієнтів",
        "50 учасників команди + ролі",
        "Пріоритетна підтримка та SLA",
      ],
      cta: "Зв'язатися з продажами",
      ctaTo: "/contact",
      highlight: false,
    },
  ];

  return (
    <main className="min-h-screen bg-background">
      <MarketingHeader />
      <section className="border-b border-border bg-gradient-to-br from-primary/10 via-background to-background">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" /> {t("pr.badge")}
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Чотири рівні. Жодних AI-кредитів.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground">
            Старт безкоштовно — і коли MARQ збільшує ваш дохід, переходьте на наступний рівень. Без
            оплат за кожен запуск агента: вищий тариф просто відкриває більше агентів та вищі ліміти
            каталогу.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((p) => (
            <Card
              key={p.name}
              className={
                p.highlight ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-card/60"
              }
            >
              <CardHeader>
                {p.highlight && (
                  <Badge className="mb-2 w-fit" variant="default">
                    {t("pr.popular")}
                  </Badge>
                )}
                <CardTitle className="text-xl">{p.name}</CardTitle>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-foreground">{p.price}</span>
                  <span className="text-xs text-muted-foreground">{p.cadence}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.priceUsd} / mo</p>
                <CardDescription className="mt-2">{p.desc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild className="w-full" variant={p.highlight ? "default" : "outline"}>
                  <Link to={p.ctaTo}>{p.cta}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mx-auto mt-10 max-w-2xl rounded-lg border border-border bg-muted/20 p-6 text-center">
          <p className="text-sm font-medium text-foreground">
            {t("site.legal.contactSales")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Гібридні тарифи, custom-агенти, корпоративні умови та on-prem — обговорюємо індивідуально.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/contact">{t("site.legal.contactSalesCta")}</Link>
          </Button>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">{t("pr.note")}</p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {t("site.legal.priceNote")}{" "}
          <Link to="/refund" className="text-primary hover:underline">
            {t("site.legal.refund")}
          </Link>
          {" · "}
          <Link to="/terms" className="text-primary hover:underline">
            {t("site.legal.terms")}
          </Link>
        </p>
      </section>
      <MarketingFooter />
    </main>
  );
}
