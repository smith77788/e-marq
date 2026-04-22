/**
 * /handbook — повний посібник користувача в стилі "інструкції до автомобіля".
 * Sticky TOC ліворуч, mission-control секції, картки конекторів, тарифи, FAQ.
 * Усі тексти — через i18n (UA за замовчуванням, EN — через LanguageSwitcher).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BookOpen,
  Bot,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  HelpCircle,
  LifeBuoy,
  Plug,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/owner/LanguageSwitcher";
import { HandbookSection } from "@/components/handbook/HandbookSection";
import { HandbookToc, HandbookTocMobile } from "@/components/handbook/HandbookToc";
import { HandbookConnectors } from "@/components/handbook/HandbookConnectors";
import { useT, tStatic } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

import heroImg from "@/assets/handbook-hero.jpg";
import approvalImg from "@/assets/handbook-approval.jpg";
import integrationsImg from "@/assets/handbook-integrations.jpg";
import pricingImg from "@/assets/handbook-pricing.jpg";

export const Route = createFileRoute("/handbook")({
  head: () =>
    buildSeo({
      title: tStatic("hb.metaTitle"),
      description: tStatic("hb.metaDesc"),
      path: "/handbook",
      ogType: "article",
    }),
  component: HandbookPage,
});

function HandbookPage() {
  const { t } = useT();

  const ownerFeatures = [
    { titleKey: "hb.owner.f1.title", bodyKey: "hb.owner.f1.body" },
    { titleKey: "hb.owner.f2.title", bodyKey: "hb.owner.f2.body" },
    { titleKey: "hb.owner.f3.title", bodyKey: "hb.owner.f3.body" },
    { titleKey: "hb.owner.f4.title", bodyKey: "hb.owner.f4.body" },
    { titleKey: "hb.owner.f5.title", bodyKey: "hb.owner.f5.body" },
    { titleKey: "hb.owner.f6.title", bodyKey: "hb.owner.f6.body" },
  ] as const;

  const adminFeatures = [
    { titleKey: "hb.admin.f1.title", bodyKey: "hb.admin.f1.body" },
    { titleKey: "hb.admin.f2.title", bodyKey: "hb.admin.f2.body" },
    { titleKey: "hb.admin.f3.title", bodyKey: "hb.admin.f3.body" },
    { titleKey: "hb.admin.f4.title", bodyKey: "hb.admin.f4.body" },
    { titleKey: "hb.admin.f5.title", bodyKey: "hb.admin.f5.body" },
    { titleKey: "hb.admin.f6.title", bodyKey: "hb.admin.f6.body" },
  ] as const;

  const agentCats = [
    { titleKey: "hb.ag.cat1", itemsKey: "hb.ag.cat1items" },
    { titleKey: "hb.ag.cat2", itemsKey: "hb.ag.cat2items" },
    { titleKey: "hb.ag.cat3", itemsKey: "hb.ag.cat3items" },
    { titleKey: "hb.ag.cat4", itemsKey: "hb.ag.cat4items" },
    { titleKey: "hb.ag.cat5", itemsKey: "hb.ag.cat5items" },
    { titleKey: "hb.ag.cat6", itemsKey: "hb.ag.cat6items" },
  ] as const;

  const whoFor = [
    { titleKey: "hb.who.b1.title", bodyKey: "hb.who.b1.body" },
    { titleKey: "hb.who.b2.title", bodyKey: "hb.who.b2.body" },
    { titleKey: "hb.who.b3.title", bodyKey: "hb.who.b3.body" },
    { titleKey: "hb.who.b4.title", bodyKey: "hb.who.b4.body" },
  ] as const;

  const quickStart = [
    "hb.qs.s1",
    "hb.qs.s2",
    "hb.qs.s3",
    "hb.qs.s4",
    "hb.qs.s5",
    "hb.qs.s6",
    "hb.qs.s7",
    "hb.qs.s8",
  ] as const;

  const faqs = [
    { qKey: "hb.faq.q1", aKey: "hb.faq.a1" },
    { qKey: "hb.faq.q2", aKey: "hb.faq.a2" },
    { qKey: "hb.faq.q3", aKey: "hb.faq.a3" },
    { qKey: "hb.faq.q4", aKey: "hb.faq.a4" },
    { qKey: "hb.faq.q5", aKey: "hb.faq.a5" },
    { qKey: "hb.faq.q6", aKey: "hb.faq.a6" },
  ] as const;

  return (
    <main className="min-h-screen bg-background">
      {/* Top nav */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            MARQ
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <Link to="/how-it-works" className="hover:text-foreground transition-colors">
              {t("site.nav.how")}
            </Link>
            <Link to="/agents" className="hover:text-foreground transition-colors">
              {t("site.nav.agents")}
            </Link>
            <Link to="/pricing" className="hover:text-foreground transition-colors">
              {t("site.nav.pricing")}
            </Link>
            <Link to="/handbook" className="font-medium text-foreground">
              {t("site.nav.handbook")}
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button asChild size="sm" variant="ghost">
              <Link to="/login">{t("site.nav.signin")}</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/signup">{t("site.nav.signup")}</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0">
          <img
            src={heroImg}
            alt=""
            aria-hidden
            decoding="async"
            fetchPriority="high"
            loading="eager"
            width={1920}
            height={1080}
            className="h-full w-full object-cover opacity-25"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
        </div>
        <div className="relative mx-auto max-w-5xl px-4 py-16 text-center sm:py-24">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <BookOpen className="mr-1 h-3 w-3" />
            {t("hb.badge")}
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl">
            {t("hb.title")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            {t("hb.subtitle")}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <a href="#quickstart">
                <Rocket className="mr-2 h-4 w-4" />
                {t("hb.toc.quickstart")}
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#integrations">
                <Plug className="mr-2 h-4 w-4" />
                {t("hb.toc.integrations")}
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Body: TOC + content */}
      <div className="mx-auto max-w-7xl px-4 py-10 lg:flex lg:gap-10 lg:py-14">
        <aside className="lg:flex-shrink-0">
          <HandbookToc />
        </aside>

        <div className="min-w-0 flex-1 space-y-16">
          <HandbookTocMobile />

          {/* What */}
          <HandbookSection
            id="what"
            eyebrow={t("hb.what.eyebrow")}
            icon={Sparkles}
            title={t("hb.what.title")}
            subtitle={t("hb.what.lead")}
          >
            <div className="grid gap-4 md:grid-cols-3">
              {[
                { titleKey: "hb.what.p1.title", bodyKey: "hb.what.p1.body" },
                { titleKey: "hb.what.p2.title", bodyKey: "hb.what.p2.body" },
                { titleKey: "hb.what.p3.title", bodyKey: "hb.what.p3.body" },
              ].map((p) => (
                <Card key={p.titleKey} className="border-border/60 bg-card/40">
                  <CardHeader>
                    <CardTitle className="text-base">{t(p.titleKey as never)}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {t(p.bodyKey as never)}
                  </CardContent>
                </Card>
              ))}
            </div>
          </HandbookSection>

          {/* Who */}
          <HandbookSection
            id="who"
            eyebrow={t("hb.who.eyebrow")}
            icon={Users}
            title={t("hb.who.title")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {whoFor.map((w) => (
                <Card key={w.titleKey} className="border-border/60 bg-card/40">
                  <CardHeader>
                    <CardTitle className="text-base">{t(w.titleKey as never)}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {t(w.bodyKey as never)}
                  </CardContent>
                </Card>
              ))}
            </div>
          </HandbookSection>

          {/* Owner panel */}
          <HandbookSection
            id="owner"
            eyebrow={t("hb.owner.eyebrow")}
            icon={LifeBuoy}
            title={t("hb.owner.title")}
            subtitle={t("hb.owner.lead")}
          >
            <Card className="overflow-hidden border-border/60 bg-card/40">
              <img
                src={approvalImg}
                alt=""
                loading="lazy"
                decoding="async"
                width={1920}
                height={1080}
                className="h-48 w-full object-cover"
              />
            </Card>
            <div className="grid gap-4 md:grid-cols-2">
              {ownerFeatures.map((f, i) => (
                <Card key={f.titleKey} className="border-border/60 bg-card/40">
                  <CardHeader className="flex-row items-start gap-3 space-y-0">
                    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <CardTitle className="text-base">{t(f.titleKey as never)}</CardTitle>
                      <CardDescription className="mt-1 text-sm">
                        {t(f.bodyKey as never)}
                      </CardDescription>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </HandbookSection>

          {/* Admin panel */}
          <HandbookSection
            id="admin"
            eyebrow={t("hb.admin.eyebrow")}
            icon={ShieldCheck}
            title={t("hb.admin.title")}
            subtitle={t("hb.admin.lead")}
          >
            <div className="grid gap-4 md:grid-cols-2">
              {adminFeatures.map((f, i) => (
                <Card key={f.titleKey} className="border-border/60 bg-card/40">
                  <CardHeader className="flex-row items-start gap-3 space-y-0">
                    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-xs font-semibold text-accent">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <CardTitle className="text-base">{t(f.titleKey as never)}</CardTitle>
                      <CardDescription className="mt-1 text-sm">
                        {t(f.bodyKey as never)}
                      </CardDescription>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </HandbookSection>

          {/* Agents */}
          <HandbookSection
            id="agents"
            eyebrow={t("hb.ag.eyebrow")}
            icon={Bot}
            title={t("hb.ag.title")}
            subtitle={t("hb.ag.lead")}
          >
            <div className="grid gap-4 md:grid-cols-2">
              {agentCats.map((c) => (
                <Card key={c.titleKey} className="border-border/60 bg-card/40">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Bot className="h-4 w-4 text-primary" />
                      {t(c.titleKey as never)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-relaxed text-muted-foreground">
                    {t(c.itemsKey as never)}
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="rounded-lg border border-border/60 bg-card/30 p-4 text-sm text-muted-foreground">
              <Building2 className="mr-2 inline h-4 w-4 text-primary" />
              <Link to="/agents" className="text-foreground underline-offset-4 hover:underline">
                {t("ag.runOnStore")}
              </Link>
            </div>
          </HandbookSection>

          {/* Integrations */}
          <HandbookSection
            id="integrations"
            eyebrow={t("hb.int.eyebrow")}
            icon={Plug}
            title={t("hb.int.title")}
            subtitle={t("hb.int.lead")}
          >
            <Card className="overflow-hidden border-border/60 bg-card/40">
              <img
                src={integrationsImg}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-44 w-full object-cover"
              />
            </Card>
            <HandbookConnectors />
            <p className="rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              {t("hb.int.note")}
            </p>
          </HandbookSection>

          {/* Pricing */}
          <HandbookSection
            id="pricing"
            eyebrow={t("hb.price.eyebrow")}
            icon={CircleDollarSign}
            title={t("hb.price.title")}
            subtitle={t("hb.price.lead")}
          >
            <Card className="overflow-hidden border-border/60 bg-card/40">
              <img
                src={pricingImg}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-40 w-full object-cover"
              />
            </Card>
            <div className="grid gap-4 md:grid-cols-3">
              {[
                {
                  titleKey: "hb.price.m1.title",
                  bodyKey: "hb.price.m1.body",
                  tiers: ["hb.price.m1.tier1", "hb.price.m1.tier2", "hb.price.m1.tier3"],
                },
                {
                  titleKey: "hb.price.m2.title",
                  bodyKey: "hb.price.m2.body",
                  tiers: ["hb.price.m2.tier1", "hb.price.m2.tier2", "hb.price.m2.tier3"],
                },
                {
                  titleKey: "hb.price.m3.title",
                  bodyKey: "hb.price.m3.body",
                  tiers: ["hb.price.m3.tier1", "hb.price.m3.tier2", "hb.price.m3.tier3"],
                },
              ].map((m) => (
                <Card key={m.titleKey} className="flex flex-col border-border/60 bg-card/40">
                  <CardHeader>
                    <CardTitle className="text-base">{t(m.titleKey as never)}</CardTitle>
                    <CardDescription>{t(m.bodyKey as never)}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2">
                    {m.tiers.map((tk) => (
                      <div
                        key={tk}
                        className="flex items-start gap-2 text-sm text-muted-foreground"
                      >
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{t(tk as never)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="text-right">
              <Button asChild variant="outline" size="sm">
                <Link to="/pricing">
                  {t("site.nav.pricing")}
                  <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </HandbookSection>

          {/* Quickstart */}
          <HandbookSection
            id="quickstart"
            eyebrow={t("hb.qs.eyebrow")}
            icon={Rocket}
            title={t("hb.qs.title")}
          >
            <ol className="space-y-3">
              {quickStart.map((k, i) => (
                <li
                  key={k}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-4"
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  <span className="text-sm text-foreground">{t(k as never)}</span>
                </li>
              ))}
            </ol>
          </HandbookSection>

          {/* FAQ */}
          <HandbookSection
            id="faq"
            eyebrow={t("hb.faq.eyebrow")}
            icon={HelpCircle}
            title={t("hb.faq.title")}
          >
            <div className="space-y-3">
              {faqs.map((f) => (
                <Card key={f.qKey} className="border-border/60 bg-card/40">
                  <CardHeader>
                    <CardTitle className="text-base">{t(f.qKey as never)}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {t(f.aKey as never)}
                  </CardContent>
                </Card>
              ))}
            </div>
          </HandbookSection>

          {/* CTA */}
          <section className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-card/50 to-background p-8 text-center shadow-glow sm:p-12">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("hb.cta.title")}</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
              {t("hb.cta.body")}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link to="/signup">{t("hb.cta.primary")}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/pricing">{t("hb.cta.secondary")}</Link>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
