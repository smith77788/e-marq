/**
 * HandbookSheet — inline-довідка, що відкривається у боковій панелі
 * безпосередньо в кабінеті. Раніше пункт «Посібник» вів на /handbook
 * (окрема маркетингова сторінка), тепер користувач бачить ключові
 * розділи без переходу.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Bot,
  CircleDollarSign,
  ExternalLink,
  HelpCircle,
  LifeBuoy,
  Plug,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HandbookConnectors } from "@/components/handbook/HandbookConnectors";
import { useT, type TKey } from "@/lib/i18n";

interface HandbookSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HandbookSheet({ open, onOpenChange }: HandbookSheetProps) {
  const { t } = useT();
  const [tab, setTab] = useState("quickstart");

  const quickStart: TKey[] = useMemo(
    () => [
      "hb.qs.s1",
      "hb.qs.s2",
      "hb.qs.s3",
      "hb.qs.s4",
      "hb.qs.s5",
      "hb.qs.s6",
      "hb.qs.s7",
      "hb.qs.s8",
    ],
    [],
  );

  const ownerFeatures: { titleKey: TKey; bodyKey: TKey }[] = useMemo(
    () => [
      { titleKey: "hb.owner.f1.title", bodyKey: "hb.owner.f1.body" },
      { titleKey: "hb.owner.f2.title", bodyKey: "hb.owner.f2.body" },
      { titleKey: "hb.owner.f3.title", bodyKey: "hb.owner.f3.body" },
      { titleKey: "hb.owner.f4.title", bodyKey: "hb.owner.f4.body" },
      { titleKey: "hb.owner.f5.title", bodyKey: "hb.owner.f5.body" },
      { titleKey: "hb.owner.f6.title", bodyKey: "hb.owner.f6.body" },
    ],
    [],
  );

  const adminFeatures: { titleKey: TKey; bodyKey: TKey }[] = useMemo(
    () => [
      { titleKey: "hb.admin.f1.title", bodyKey: "hb.admin.f1.body" },
      { titleKey: "hb.admin.f2.title", bodyKey: "hb.admin.f2.body" },
      { titleKey: "hb.admin.f3.title", bodyKey: "hb.admin.f3.body" },
      { titleKey: "hb.admin.f4.title", bodyKey: "hb.admin.f4.body" },
      { titleKey: "hb.admin.f5.title", bodyKey: "hb.admin.f5.body" },
      { titleKey: "hb.admin.f6.title", bodyKey: "hb.admin.f6.body" },
    ],
    [],
  );

  const agentCats: { titleKey: TKey; itemsKey: TKey }[] = useMemo(
    () => [
      { titleKey: "hb.ag.cat1", itemsKey: "hb.ag.cat1items" },
      { titleKey: "hb.ag.cat2", itemsKey: "hb.ag.cat2items" },
      { titleKey: "hb.ag.cat3", itemsKey: "hb.ag.cat3items" },
      { titleKey: "hb.ag.cat4", itemsKey: "hb.ag.cat4items" },
      { titleKey: "hb.ag.cat5", itemsKey: "hb.ag.cat5items" },
      { titleKey: "hb.ag.cat6", itemsKey: "hb.ag.cat6items" },
    ],
    [],
  );

  const faqs: { qKey: TKey; aKey: TKey }[] = useMemo(
    () => [
      { qKey: "hb.faq.q1", aKey: "hb.faq.a1" },
      { qKey: "hb.faq.q2", aKey: "hb.faq.a2" },
      { qKey: "hb.faq.q3", aKey: "hb.faq.a3" },
      { qKey: "hb.faq.q4", aKey: "hb.faq.a4" },
      { qKey: "hb.faq.q5", aKey: "hb.faq.a5" },
      { qKey: "hb.faq.q6", aKey: "hb.faq.a6" },
    ],
    [],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b border-border bg-card/30 px-5 py-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <BookOpen className="h-4 w-4" />
            </span>
            {t("hb.title")}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {t("hb.subtitle")}
          </SheetDescription>
        </SheetHeader>

        <div className="border-b border-border bg-background/40 px-5 py-2">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex w-full flex-wrap justify-start gap-1 bg-transparent p-0">
              <TabsTrigger value="quickstart" className="gap-1.5 text-xs">
                <Rocket className="h-3.5 w-3.5" /> {t("hb.toc.quickstart")}
              </TabsTrigger>
              <TabsTrigger value="owner" className="gap-1.5 text-xs">
                <LifeBuoy className="h-3.5 w-3.5" /> {t("hb.toc.owner")}
              </TabsTrigger>
              <TabsTrigger value="admin" className="gap-1.5 text-xs">
                <ShieldCheck className="h-3.5 w-3.5" /> {t("hb.toc.admin")}
              </TabsTrigger>
              <TabsTrigger value="agents" className="gap-1.5 text-xs">
                <Bot className="h-3.5 w-3.5" /> {t("hb.toc.agents")}
              </TabsTrigger>
              <TabsTrigger value="integrations" className="gap-1.5 text-xs">
                <Plug className="h-3.5 w-3.5" /> {t("hb.toc.integrations")}
              </TabsTrigger>
              <TabsTrigger value="faq" className="gap-1.5 text-xs">
                <HelpCircle className="h-3.5 w-3.5" /> {t("hb.toc.faq")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-6 p-5">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsContent value="quickstart" className="mt-0 space-y-3">
                <SectionEyebrow icon={Rocket} text={t("hb.qs.eyebrow")} />
                <h3 className="text-lg font-semibold text-foreground">
                  {t("hb.qs.title")}
                </h3>
                <ol className="space-y-2.5">
                  {quickStart.map((k, i) => (
                    <li
                      key={k}
                      className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-3"
                    >
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                        {i + 1}
                      </span>
                      <span className="text-sm text-foreground">{t(k)}</span>
                    </li>
                  ))}
                </ol>
              </TabsContent>

              <TabsContent value="owner" className="mt-0 space-y-3">
                <SectionEyebrow icon={Users} text={t("hb.owner.eyebrow")} />
                <h3 className="text-lg font-semibold text-foreground">
                  {t("hb.owner.title")}
                </h3>
                <p className="text-sm text-muted-foreground">{t("hb.owner.lead")}</p>
                <div className="grid gap-3">
                  {ownerFeatures.map((f, i) => (
                    <Card key={f.titleKey} className="border-border/60 bg-card/40">
                      <CardHeader className="flex-row items-start gap-3 space-y-0 p-3">
                        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <CardTitle className="text-sm">{t(f.titleKey)}</CardTitle>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t(f.bodyKey)}
                          </p>
                        </div>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="admin" className="mt-0 space-y-3">
                <SectionEyebrow icon={ShieldCheck} text={t("hb.admin.eyebrow")} />
                <h3 className="text-lg font-semibold text-foreground">
                  {t("hb.admin.title")}
                </h3>
                <p className="text-sm text-muted-foreground">{t("hb.admin.lead")}</p>
                <div className="grid gap-3">
                  {adminFeatures.map((f, i) => (
                    <Card key={f.titleKey} className="border-border/60 bg-card/40">
                      <CardHeader className="flex-row items-start gap-3 space-y-0 p-3">
                        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/10 text-[11px] font-semibold text-accent">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <CardTitle className="text-sm">{t(f.titleKey)}</CardTitle>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t(f.bodyKey)}
                          </p>
                        </div>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="agents" className="mt-0 space-y-3">
                <SectionEyebrow icon={Bot} text={t("hb.ag.eyebrow")} />
                <h3 className="text-lg font-semibold text-foreground">
                  {t("hb.ag.title")}
                </h3>
                <p className="text-sm text-muted-foreground">{t("hb.ag.lead")}</p>
                <div className="grid gap-3">
                  {agentCats.map((c) => (
                    <Card key={c.titleKey} className="border-border/60 bg-card/40">
                      <CardHeader className="p-3">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Bot className="h-3.5 w-3.5 text-primary" />
                          {t(c.titleKey)}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-3 pt-0 text-xs leading-relaxed text-muted-foreground">
                        {t(c.itemsKey)}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="integrations" className="mt-0 space-y-3">
                <SectionEyebrow icon={Plug} text={t("hb.int.eyebrow")} />
                <h3 className="text-lg font-semibold text-foreground">
                  {t("hb.int.title")}
                </h3>
                <p className="text-sm text-muted-foreground">{t("hb.int.lead")}</p>
                <HandbookConnectors />
                <p className="rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                  {t("hb.int.note")}
                </p>
              </TabsContent>

              <TabsContent value="faq" className="mt-0 space-y-3">
                <SectionEyebrow icon={HelpCircle} text={t("hb.faq.eyebrow")} />
                <h3 className="text-lg font-semibold text-foreground">
                  {t("hb.faq.title")}
                </h3>
                <div className="space-y-2.5">
                  {faqs.map((f) => (
                    <details
                      key={f.qKey}
                      className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm"
                    >
                      <summary className="cursor-pointer list-none font-medium text-foreground">
                        <span className="inline-flex items-center gap-2">
                          <HelpCircle className="h-3.5 w-3.5 text-primary" />
                          {t(f.qKey)}
                        </span>
                      </summary>
                      <p className="mt-2 text-xs text-muted-foreground">{t(f.aKey)}</p>
                    </details>
                  ))}
                </div>
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="flex items-center gap-3 p-3">
                    <CircleDollarSign className="h-4 w-4 text-primary" />
                    <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                      {t("hb.price.lead")}
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/pricing" onClick={() => onOpenChange(false)}>
                        {t("site.nav.pricing")}
                        <ArrowRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>

        <div className="border-t border-border bg-card/30 px-5 py-3">
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to="/handbook" onClick={() => onOpenChange(false)}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {t("hb.openFullPage")}
              <ExternalLink className="ml-1.5 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SectionEyebrow({
  icon: Icon,
  text,
}: {
  icon: typeof BookOpen;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
        <Icon className="mr-1 h-3 w-3" />
        {text}
      </Badge>
    </div>
  );
}
