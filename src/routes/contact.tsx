import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Mail, MessageSquare, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/MarketingShell";
import { useT, tStatic } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/contact")({
  head: () =>
    buildSeo({
      title: tStatic("ct.metaTitle"),
      description: tStatic("ct.metaDesc"),
      path: "/contact",
    }),
  component: ContactPage,
});

function ContactPage() {
  const { t } = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    // Lightweight mailto fallback — keeps the page functional without backend wiring
    const subject = encodeURIComponent(`MARQ inquiry — ${name || "no name"}`);
    const body = encodeURIComponent(`From: ${name} <${email}>\n\n${message}`);
    window.location.href = `mailto:hello@marq.app?subject=${subject}&body=${body}`;
    setTimeout(() => {
      toast.success(t("ct.toastOk"));
      setSubmitting(false);
    }, 400);
  };

  return (
    <main className="min-h-screen bg-background">
      <MarketingHeader />

      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" /> {t("ct.badge")}
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">{t("ct.title")}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground">{t("ct.subtitle")}</p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <div className="grid gap-8 lg:grid-cols-[1fr,360px]">
          <Card className="border-border bg-card/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-4 w-4 text-primary" />
                {t("ct.formTitle")}
              </CardTitle>
              <CardDescription>{t("ct.formDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="ct-name">{t("ct.name")}</Label>
                  <Input id="ct-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ct.namePh")} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ct-email">{t("ct.email")}</Label>
                  <Input id="ct-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ct-msg">{t("ct.message")}</Label>
                  <Textarea id="ct-msg" rows={6} required value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("ct.messagePh")} />
                </div>
                <Button type="submit" disabled={submitting} className="w-full">
                  <Send className="mr-2 h-4 w-4" />
                  {submitting ? t("ct.sending") : t("ct.send")}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-border bg-card/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4 text-primary" />
                  {t("ct.directTitle")}
                </CardTitle>
                <CardDescription>{t("ct.directDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <a href="mailto:hello@marq.app" className="block text-foreground hover:text-primary">
                  hello@marq.app
                </a>
                <a href="mailto:support@marq.app" className="block text-foreground hover:text-primary">
                  support@marq.app
                </a>
              </CardContent>
            </Card>

            <Card className="border-primary/30 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-base">{t("ct.fastTitle")}</CardTitle>
                <CardDescription>{t("ct.fastDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full">
                  <Link to="/signup">{t("ct.fastCta")}</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
