/**
 * 7-step Onboarding wizard. Доступний за /onboarding?tenant=...&slug=...
 * Якщо tenant не передано — показуємо selector серед моїх tenants.
 *
 * Кожен крок зберігає прогрес одразу (idempotent), тому користувач може
 * вийти і повернутися без втрат.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Copy, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { LanguageSwitcher } from "@/components/owner/LanguageSwitcher";
import { IntegrationGuide } from "@/components/owner/IntegrationGuide";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useT, type TKey } from "@/lib/i18n";

type Search = { tenant?: string; slug?: string };

export const Route = createFileRoute("/_authenticated/onboarding")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
    slug: typeof s.slug === "string" ? s.slug : undefined,
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const search = useSearch({ from: "/_authenticated/onboarding" });
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, lang } = useT();
  const qc = useQueryClient();

  const { data: tenants } = useQuery({
    queryKey: ["my-tenants", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("id, name, slug").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Auto-select tenant from URL or first one
  const tenantId = search.tenant ?? tenants?.[0]?.id;
  const tenantSlug = search.slug ?? tenants?.find((t) => t.id === tenantId)?.slug;

  useEffect(() => {
    if (!search.tenant && tenants && tenants[0]) {
      navigate({ to: "/onboarding", search: { tenant: tenants[0].id, slug: tenants[0].slug }, replace: true });
    }
  }, [search.tenant, tenants, navigate]);

  const [step, setStep] = useState(0);

  if (!tenantId || !tenantSlug) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("onb.title")}</CardTitle>
          <CardDescription>
            {lang === "ua" ? "Спочатку створи бренд або попроси super-admin." : "Create a brand first or ask a super-admin."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const steps: Array<{ titleKey: TKey; descKey: TKey; render: () => ReactElement }> = [
    { titleKey: "onb.s1.title", descKey: "onb.s1.desc", render: () => <Step1Brand tenantId={tenantId} qc={qc} /> },
    { titleKey: "onb.s2.title", descKey: "onb.s2.desc", render: () => <Step2Channel tenantId={tenantId} qc={qc} /> },
    { titleKey: "onb.s3.title", descKey: "onb.s3.desc", render: () => <Step3Product tenantId={tenantId} qc={qc} /> },
    { titleKey: "onb.s4.title", descKey: "onb.s4.desc", render: () => <Step4Customers tenantId={tenantId} qc={qc} /> },
    { titleKey: "onb.s5.title", descKey: "onb.s5.desc", render: () => <Step5Tracking tenantSlug={tenantSlug} /> },
    { titleKey: "onb.s6.title", descKey: "onb.s6.desc", render: () => <Step6Payment tenantId={tenantId} qc={qc} /> },
    { titleKey: "onb.s7.title", descKey: "onb.s7.desc", render: () => <Step7Team tenantId={tenantId} /> },
  ];

  const pct = Math.round(((step + 1) / steps.length) * 100);
  const isLast = step === steps.length - 1;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("onb.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("onb.subtitle")}</p>
        </div>
        <LanguageSwitcher />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t("onb.step")} {step + 1} {t("onb.of")} {steps.length}
          </span>
          <span>{pct}%</span>
        </div>
        <Progress value={pct} className="h-2" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t(steps[step].titleKey)}
          </CardTitle>
          <CardDescription>{t(steps[step].descKey)}</CardDescription>
        </CardHeader>
        <CardContent>{steps[step].render()}</CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t("onb.back")}
        </Button>
        <div className="flex items-center gap-2">
          {!isLast && (
            <Button variant="outline" onClick={() => setStep((s) => s + 1)}>
              {t("onb.skip")}
            </Button>
          )}
          {isLast ? (
            <Button asChild>
              <Link to="/brand" search={{ tenant: tenantId }}>
                <Check className="mr-1 h-4 w-4" />
                {t("onb.finish")}
              </Link>
            </Button>
          ) : (
            <Button onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}>
              {t("onb.next")}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------- STEPS --------------------

type QC = ReturnType<typeof useQueryClient>;

function Step1Brand({ tenantId, qc }: { tenantId: string; qc: QC }) {
  const { t } = useT();
  const { data: tenant } = useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle();
      return data;
    },
  });
  const [name, setName] = useState("");
  useEffect(() => {
    if (tenant?.name) setName(tenant.name);
  }, [tenant?.name]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("tenants").update({ name }).eq("id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("common.save") + " ✓");
      qc.invalidateQueries({ queryKey: ["tenant", tenantId] });
      qc.invalidateQueries({ queryKey: ["my-tenants"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <Label>{t("onb.s1.title")}</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("onb.s1.placeholder")} />
      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !name}>
        {save.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        {t("common.save")}
      </Button>
    </div>
  );
}

function Step2Channel({ tenantId, qc: _qc }: { tenantId: string; qc: QC }) {
  const { data: tenant } = useQuery({
    queryKey: ["tenant-slug", tenantId],
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
      return data;
    },
  });
  const slug = tenant?.slug ?? "";
  const deepLink = slug ? `https://t.me/Oauther_bot?start=${slug}` : "";

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-success/30 bg-success/10 p-3 text-xs text-success">
        ✅ Telegram-бот <strong>@Oauther_bot</strong> вже працює. Не треба створювати власного.
      </div>
      <p className="text-xs text-muted-foreground">
        Поширюйте посилання нижче — клієнти натискають його, бот вітає від імені вашого бренду
        і автоматично прив&apos;язується до вашого магазину.
      </p>
      <div className="flex gap-2">
        <Input readOnly value={deepLink} className="font-mono text-xs" />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(deepLink).then(() => toast.success("Скопійовано"));
          }}
          disabled={!deepLink}
        >
          Скопіювати
        </Button>
      </div>
      {deepLink && (
        <Button size="sm" asChild>
          <a href={deepLink} target="_blank" rel="noreferrer">
            Відкрити бота для тесту →
          </a>
        </Button>
      )}
    </div>
  );
}

function Step3Product({ tenantId, qc }: { tenantId: string; qc: QC }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const priceCents = Math.round(Number(price) * 100);
      const stockNum = Math.max(0, parseInt(stock || "0", 10));
      if (!name || !Number.isFinite(priceCents) || priceCents <= 0) throw new Error("Заповніть назву та ціну");
      const { error } = await supabase.from("products").insert({
        tenant_id: tenantId,
        name,
        price_cents: priceCents,
        stock: stockNum,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Готово · товар створено");
      setName("");
      setPrice("");
      setStock("");
      qc.invalidateQueries({ queryKey: ["setup-checklist", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("onb.s3.namePh")} />
      <div className="grid grid-cols-2 gap-3">
        <Input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder={t("onb.s3.pricePh")}
          type="number"
          step="0.01"
          min="0"
        />
        <Input
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          placeholder={t("onb.s3.stockPh")}
          type="number"
          min="0"
        />
      </div>
      <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
        {create.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        {t("common.save")}
      </Button>
    </div>
  );
}

function Step4Customers({ tenantId, qc }: { tenantId: string; qc: QC }) {
  const { t, lang } = useT();
  const [csv, setCsv] = useState("");

  const importCsv = useMutation({
    mutationFn: async () => {
      const lines = csv.trim().split(/\r?\n/);
      const rows = lines
        .slice(1) // skip header
        .map((l) => {
          const [email, name] = l.split(",").map((s) => s.trim());
          return email ? { tenant_id: tenantId, email, name: name || null } : null;
        })
        .filter(Boolean) as { tenant_id: string; email: string; name: string | null }[];
      if (rows.length === 0) throw new Error("Не знайдено жодного рядка з email");
      const { error } = await supabase.from("customers").insert(rows as never);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(`Готово · додано клієнтів: ${n}`);
      setCsv("");
      qc.invalidateQueries({ queryKey: ["setup-checklist", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("onb.s4.csvHint")}</p>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={"email,name\nalice@example.com,Alice\nbob@example.com,Bob"}
        className="min-h-32 w-full rounded-md border border-border bg-background p-3 font-mono text-xs"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => importCsv.mutate()} disabled={importCsv.isPending || !csv.trim()}>
          {importCsv.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {t("onb.s4.csv")}
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link to="/admin/tenants/$tenantId" params={{ tenantId }}>
            {lang === "ua" ? "Адмін-панель тенанта" : "Tenant admin"}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Step5Tracking({ tenantSlug }: { tenantSlug: string }) {
  return <IntegrationGuide tenantSlug={tenantSlug} />;
}

function Step6Payment({ tenantId, qc }: { tenantId: string; qc: QC }) {
  const { t } = useT();
  const { data: cfg } = useQuery({
    queryKey: ["tenant-config", tenantId],
    queryFn: async () => {
      const { data } = await supabase.from("tenant_configs").select("features").eq("tenant_id", tenantId).maybeSingle();
      return data;
    },
  });
  const current = ((cfg?.features ?? {}) as Record<string, unknown>).payment_method as string | undefined;

  const setMethod = useMutation({
    mutationFn: async (method: "manual" | "stripe") => {
      const features = { ...((cfg?.features ?? {}) as Record<string, unknown>), payment_method: method };
      const { error } = await supabase.from("tenant_configs").update({ features: features as never }).eq("tenant_id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("common.save") + " ✓");
      qc.invalidateQueries({ queryKey: ["tenant-config", tenantId] });
      qc.invalidateQueries({ queryKey: ["setup-checklist", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-2">
      {(["manual", "stripe"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMethod.mutate(m)}
          className={`rounded-md border p-3 text-left text-sm transition-colors ${
            current === m ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
          }`}
        >
          <div className="font-medium">{m === "manual" ? t("onb.s6.manual") : t("onb.s6.stripe")}</div>
        </button>
      ))}
    </div>
  );
}

function Step7Team({ tenantId }: { tenantId: string }) {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");

  const { data: invites = [] } = useQuery({
    queryKey: ["tenant-invitations", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_invitations")
        .select("id, email, role, token, status, expires_at, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_tenant_invitation", {
        _tenant_id: tenantId,
        _email: email,
        _role: "admin",
      });
      if (error) throw error;
      return data as { token: string; email: string };
    },
    onSuccess: async (res) => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["tenant-invitations", tenantId] });
      try {
        await navigator.clipboard.writeText(inviteUrl(res.token));
        toast.success(
          lang === "ua"
            ? `Запрошення створено для ${res.email}. Посилання скопійовано в буфер.`
            : `Invite created for ${res.email}. Link copied to clipboard.`,
        );
      } catch {
        toast.success(
          lang === "ua" ? `Запрошення створено для ${res.email}.` : `Invite created for ${res.email}.`,
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tenant_invitations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(lang === "ua" ? "Запрошення відкликано" : "Invitation revoked");
      qc.invalidateQueries({ queryKey: ["tenant-invitations", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("onb.s7.emailPh")}
          type="email"
          onKeyDown={(e) => {
            if (e.key === "Enter" && email && /\S+@\S+\.\S+/.test(email)) create.mutate();
          }}
        />
        <Button
          size="sm"
          onClick={() => create.mutate()}
          disabled={create.isPending || !email || !/\S+@\S+\.\S+/.test(email)}
        >
          {create.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {t("onb.s7.add")}
        </Button>
      </div>

      {invites.length > 0 && (
        <ul className="space-y-1 text-sm">
          {invites.map((inv) => {
            const url = inviteUrl(inv.token);
            const isPending = inv.status === "pending";
            return (
              <li
                key={inv.id}
                className="flex flex-col gap-1 rounded-md border border-border bg-muted/20 px-2 py-2"
              >
                <div className="flex items-center gap-2">
                  <Check className={`h-3.5 w-3.5 ${isPending ? "text-success" : "text-muted-foreground"}`} />
                  <span className="font-medium">{inv.email}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {inv.status === "pending"
                      ? t("onb.s7.invited")
                      : inv.status === "accepted"
                        ? lang === "ua" ? "Прийнято" : "Accepted"
                        : inv.status}
                  </span>
                </div>
                {isPending && (
                  <div className="flex items-center gap-1">
                    <Input readOnly value={url} className="h-7 font-mono text-[10px]" />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2"
                      onClick={() => {
                        navigator.clipboard.writeText(url).then(() =>
                          toast.success(lang === "ua" ? "Скопійовано" : "Copied"),
                        );
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => revoke.mutate(inv.id)}
                      disabled={revoke.isPending}
                    >
                      ×
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        💡{" "}
        {lang === "ua"
          ? "Надішли посилання колезі — після входу/реєстрації з тим самим email вони автоматично отримають доступ до бренду. Термін дії: 14 днів."
          : "Send the link to your teammate — after they sign in with the same email, they'll get instant access. Valid for 14 days."}
      </p>
    </div>
  );
}

