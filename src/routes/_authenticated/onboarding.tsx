/**
 * 7-step Onboarding wizard. Доступний за /onboarding?tenant=...&slug=...
 * Якщо tenant не передано — показуємо selector серед моїх tenants.
 *
 * Кожен крок зберігає прогрес одразу (idempotent), тому користувач може
 * вийти і повернутися без втрат.
 */
import { useEffect, useState, type ReactElement } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Loader2,
  Mail,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useT, type TKey, type Lang } from "@/lib/i18n";

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
  const { user, loading: authLoading } = useAuth();
  const { t, lang } = useT();
  const qc = useQueryClient();

  // Чекаємо доки відновиться сесія, щоб RLS-запити не падали через auth.uid()=null
  const authReady = !authLoading && !!user;

  const tenantsQuery = useQuery({
    queryKey: ["my-tenants", user?.id],
    enabled: authReady,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const tenants = tenantsQuery.data;

  // Auto-select tenant from URL or first one
  const tenantId = search.tenant ?? tenants?.[0]?.id;
  const tenantSlug = search.slug ?? tenants?.find((t) => t.id === tenantId)?.slug;

  useEffect(() => {
    if (!search.tenant && tenants && tenants[0]) {
      navigate({
        to: "/onboarding",
        search: { tenant: tenants[0].id, slug: tenants[0].slug },
        replace: true,
      });
    }
  }, [search.tenant, tenants, navigate]);

  const [step, setStep] = useState(0);

  // Статуси завершення кожного кроку — рахуємо за реальними даними з бази.
  // Запит виконується тільки коли auth повністю готова, з retry і явним
  // станом помилки, щоб тимчасові збої мережі не показували "0/7".
  const statusQuery = useQuery({
    queryKey: ["onboarding-status", tenantId],
    enabled: authReady && !!tenantId,
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 5_000,
    queryFn: async () => {
      if (!tenantId) return null;
      const [tn, prod, cust, cfg, tg] = await Promise.all([
        supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("is_active", true),
        supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId),
        supabase.from("tenant_configs").select("features").eq("tenant_id", tenantId).maybeSingle(),
        supabase
          .from("telegram_chat_routing")
          .select("chat_id", { count: "exact", head: true })
          .eq("tenant_id", tenantId),
      ]);
      const firstErr = [tn.error, prod.error, cust.error, cfg.error, tg.error].find(Boolean);
      if (firstErr) throw firstErr;
      const features = (cfg.data?.features ?? {}) as Record<string, unknown>;
      return {
        s1: !!(tn.data?.name && tn.data.name.trim().length > 1),
        s2: (tg.count ?? 0) > 0,
        s3: (prod.count ?? 0) > 0,
        s4: (cust.count ?? 0) > 0,
        s5: !!features.tracking_installed,
        s6: !!features.payment_method,
      };
    },
  });
  const status = statusQuery.data;

  // 1. Поки auth відновлюється — show skeleton, не редіректимо і не показуємо "пусто"
  if (!authReady) {
    return (
      <OnboardingSkeleton
        label={lang === "ua" ? "Відновлюємо ваш сеанс…" : "Restoring your session…"}
      />
    );
  }

  // 2. Поки tenants ще вантажаться — show skeleton
  if (tenantsQuery.isLoading) {
    return (
      <OnboardingSkeleton
        label={lang === "ua" ? "Завантажуємо ваші бренди…" : "Loading your brands…"}
      />
    );
  }

  // 3. Помилка завантаження tenants — даємо Retry
  if (tenantsQuery.isError) {
    return (
      <OnboardingError
        message={
          lang === "ua"
            ? "Не вдалося завантажити список ваших брендів. Перевірте інтернет і спробуйте ще раз."
            : "Couldn't load your brands. Check your connection and try again."
        }
        onRetry={() => tenantsQuery.refetch()}
        retrying={tenantsQuery.isFetching}
      />
    );
  }

  if (!tenantId || !tenantSlug) {
    return <CreateFirstTenant lang={lang} qc={qc} navigate={navigate} />;
  }

  // 4. Перше завантаження статусів — показуємо скелетон над майстром,
  // щоб не блимало "0/7" перед справжніми даними.
  const statusLoading = statusQuery.isLoading || (statusQuery.isFetching && !status);
  const statusError = statusQuery.isError && !status;

  const stepDone = (i: number): boolean => {
    if (!status) return false;
    return (
      [status.s1, status.s2, status.s3, status.s4, status.s5, status.s6, status.s7][i] ?? false
    );
  };

  const steps: Array<{ titleKey: TKey; descKey: TKey; render: () => ReactElement }> = [
    {
      titleKey: "onb.s1.title",
      descKey: "onb.s1.desc",
      render: () => <Step1Brand tenantId={tenantId} qc={qc} />,
    },
    {
      titleKey: "onb.s2.title",
      descKey: "onb.s2.desc",
      render: () => <Step2Channel tenantId={tenantId} qc={qc} />,
    },
    {
      titleKey: "onb.s3.title",
      descKey: "onb.s3.desc",
      render: () => <Step3Product tenantId={tenantId} qc={qc} />,
    },
    {
      titleKey: "onb.s4.title",
      descKey: "onb.s4.desc",
      render: () => <Step4Customers tenantId={tenantId} qc={qc} />,
    },
    {
      titleKey: "onb.s5.title",
      descKey: "onb.s5.desc",
      render: () => <Step5Tracking tenantSlug={tenantSlug} />,
    },
    {
      titleKey: "onb.s6.title",
      descKey: "onb.s6.desc",
      render: () => <Step6Payment tenantId={tenantId} qc={qc} />,
    },
    {
      titleKey: "onb.s7.title",
      descKey: "onb.s7.desc",
      render: () => <Step7Team tenantId={tenantId} tenantSlug={tenantSlug} />,
    },
  ];

  const doneCount = steps.filter((_, i) => stepDone(i)).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const isLast = step === steps.length - 1;
  const currentDone = stepDone(step);

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
          <span className="flex items-center gap-1.5">
            {lang === "ua" ? "Виконано" : "Completed"}:{" "}
            {statusLoading ? (
              <Skeleton className="inline-block h-3 w-10 align-middle" />
            ) : statusError ? (
              <span className="text-destructive">— / {steps.length}</span>
            ) : (
              <>
                {doneCount} / {steps.length}
              </>
            )}
            {statusQuery.isFetching && !statusLoading && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/60" />
            )}
          </span>
          <span>
            {statusLoading ? <Skeleton className="inline-block h-3 w-8 align-middle" /> : `${pct}%`}
          </span>
        </div>
        <Progress value={statusLoading ? 0 : pct} className="h-2" />

        {statusError && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <span className="flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              {lang === "ua"
                ? "Не вдалося оновити статуси кроків. Дані можуть бути застарілі."
                : "Couldn't refresh step statuses. Data may be outdated."}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={() => statusQuery.refetch()}
              disabled={statusQuery.isFetching}
            >
              <RefreshCw
                className={`mr-1 h-3 w-3 ${statusQuery.isFetching ? "animate-spin" : ""}`}
              />
              {lang === "ua" ? "Спробувати ще" : "Retry"}
            </Button>
          </div>
        )}

        {/* Step dots: дозволяють перейти на будь-який крок одним кліком */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {steps.map((s, i) => {
            const done = stepDone(i);
            const active = i === step;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setStep(i)}
                title={t(s.titleKey)}
                disabled={statusLoading}
                className={`flex h-7 min-w-[28px] items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors disabled:opacity-60 ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                      ? "border-success/50 bg-success/10 text-success hover:bg-success/20"
                      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {statusLoading ? (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current opacity-40" />
                ) : done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  i + 1
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {currentDone ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="h-3.5 w-3.5" />
              </span>
            ) : (
              <Sparkles className="h-5 w-5 text-primary" />
            )}
            {t(steps[step].titleKey)}
            {currentDone && (
              <span className="ml-auto rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-success">
                {lang === "ua" ? "Готово" : "Done"}
              </span>
            )}
          </CardTitle>
          <CardDescription>{t(steps[step].descKey)}</CardDescription>
        </CardHeader>
        <CardContent>{steps[step].render()}</CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
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
      const { data } = await supabase
        .from("tenants")
        .select("name, slug")
        .eq("id", tenantId)
        .maybeSingle();
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
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("onb.s1.placeholder")}
      />
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
      const { data } = await supabase
        .from("tenants")
        .select("slug")
        .eq("id", tenantId)
        .maybeSingle();
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
        Поширюйте посилання нижче — клієнти натискають його, бот вітає від імені вашого бренду і
        автоматично прив&apos;язується до вашого магазину.
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
      if (!name || !Number.isFinite(priceCents) || priceCents <= 0)
        throw new Error("Заповніть назву та ціну");
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
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("onb.s3.namePh")}
      />
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
        <Button
          size="sm"
          onClick={() => importCsv.mutate()}
          disabled={importCsv.isPending || !csv.trim()}
        >
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
      const { data } = await supabase
        .from("tenant_configs")
        .select("features")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      return data;
    },
  });
  const current = ((cfg?.features ?? {}) as Record<string, unknown>).payment_method as
    | string
    | undefined;

  const setMethod = useMutation({
    mutationFn: async (method: "manual" | "stripe") => {
      const features = {
        ...((cfg?.features ?? {}) as Record<string, unknown>),
        payment_method: method,
      };
      const { error } = await supabase
        .from("tenant_configs")
        .update({ features: features as never })
        .eq("tenant_id", tenantId);
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
          <div className="font-medium">
            {m === "manual" ? t("onb.s6.manual") : t("onb.s6.stripe")}
          </div>
        </button>
      ))}
    </div>
  );
}

function Step7Team({ tenantId, tenantSlug }: { tenantId: string; tenantSlug: string }) {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");

  const { data: brand } = useQuery({
    queryKey: ["tenant-name", tenantId],
    queryFn: async () => {
      const { data } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", tenantId)
        .maybeSingle();
      return data?.name ?? "";
    },
  });

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

  const buildMailto = (recipientEmail: string, url: string) => {
    const brandName = brand || tenantSlug;
    const subject =
      lang === "ua" ? `Запрошення до команди «${brandName}»` : `You're invited to «${brandName}»`;
    const body =
      lang === "ua"
        ? `Привіт!\n\nЗапрошую тебе долучитися до команди бренду «${brandName}» в Oauther.\n\nПосилання для приєднання (дійсне 14 днів):\n${url}\n\nПросто відкрий його у браузері й увійди — доступ надасться автоматично.`
        : `Hi!\n\nYou're invited to join the «${brandName}» brand team on Oauther.\n\nUse this link to accept (valid for 14 days):\n${url}\n\nJust open it in a browser and sign in — access will be granted automatically.`;
    return `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const create = useMutation({
    mutationFn: async () => {
      const trimmed = email.trim().toLowerCase();
      if (!/\S+@\S+\.\S+/.test(trimmed)) {
        throw new Error(
          lang === "ua" ? "Перевірте email — здається, він некоректний." : "Email looks invalid.",
        );
      }
      const { data, error } = await supabase.rpc("create_tenant_invitation", {
        _tenant_id: tenantId,
        _email: trimmed,
        _role: "admin",
      });
      if (error) throw error;
      return data as { token: string; email: string };
    },
    onSuccess: async (res) => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["tenant-invitations", tenantId] });
      qc.invalidateQueries({ queryKey: ["onboarding-status", tenantId] });
      const url = inviteUrl(res.token);
      try {
        await navigator.clipboard.writeText(url);
        toast.success(
          lang === "ua"
            ? `Запрошення для ${res.email} створено. Посилання вже у вашому буфері — вставте у будь-який месенджер чи лист.`
            : `Invite for ${res.email} created. Link copied to clipboard — paste it into any messenger or email.`,
        );
      } catch {
        toast.success(
          lang === "ua"
            ? `Запрошення для ${res.email} створено.`
            : `Invite for ${res.email} created.`,
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
      toast.success(lang === "ua" ? "Запрошення скасовано." : "Invitation revoked.");
      qc.invalidateQueries({ queryKey: ["tenant-invitations", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const emailValid = /\S+@\S+\.\S+/.test(email.trim());

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        {lang === "ua"
          ? "Введіть email колеги. Ми створимо персональне посилання — копіюйте його або одразу відкрийте поштовий клієнт із готовим листом."
          : "Type your teammate's email. We'll create a personal link — copy it or open your email client with a ready-to-send message."}
      </div>

      <div className="flex gap-2">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("onb.s7.emailPh")}
          type="email"
          onKeyDown={(e) => {
            if (e.key === "Enter" && emailValid) create.mutate();
          }}
        />
        <Button
          size="sm"
          onClick={() => create.mutate()}
          disabled={create.isPending || !emailValid}
        >
          {create.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {t("onb.s7.add")}
        </Button>
      </div>

      {invites.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {invites.map((inv) => {
            const url = inviteUrl(inv.token);
            const isPending = inv.status === "pending";
            return (
              <li
                key={inv.id}
                className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/20 px-2 py-2"
              >
                <div className="flex items-center gap-2">
                  <Check
                    className={`h-3.5 w-3.5 ${isPending ? "text-success" : "text-muted-foreground"}`}
                  />
                  <span className="font-medium">{inv.email}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {inv.status === "pending"
                      ? lang === "ua"
                        ? "Очікує"
                        : "Pending"
                      : inv.status === "accepted"
                        ? lang === "ua"
                          ? "Прийнято ✓"
                          : "Accepted ✓"
                        : inv.status}
                  </span>
                </div>
                {isPending && (
                  <>
                    <div className="flex items-center gap-1">
                      <Input readOnly value={url} className="h-7 font-mono text-[10px]" />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(url)
                            .then(() => toast.success(lang === "ua" ? "Скопійовано." : "Copied."));
                        }}
                        title={lang === "ua" ? "Скопіювати посилання" : "Copy link"}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (
                            confirm(
                              lang === "ua"
                                ? "Скасувати це запрошення?"
                                : "Revoke this invitation?",
                            )
                          ) {
                            revoke.mutate(inv.id);
                          }
                        }}
                        disabled={revoke.isPending}
                        title={lang === "ua" ? "Скасувати" : "Revoke"}
                      >
                        ×
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2 text-xs"
                        asChild
                      >
                        <a href={buildMailto(inv.email, url)}>
                          <Mail className="mr-1 h-3 w-3" />
                          {lang === "ua" ? "Відкрити лист у пошті" : "Open in email app"}
                        </a>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        asChild
                      >
                        <a
                          href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(
                            lang === "ua"
                              ? `Запрошення до команди бренду «${brand || tenantSlug}»`
                              : `Invite to «${brand || tenantSlug}»`,
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {lang === "ua" ? "Надіслати в Telegram" : "Share via Telegram"}
                        </a>
                      </Button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-foreground/80">
        💡{" "}
        {lang === "ua"
          ? "Надішліть посилання колезі будь-яким зручним способом (пошта, Telegram, месенджер). Після того як він відкриє його та увійде — отримає доступ автоматично. Термін дії посилання — 14 днів."
          : "Share the link with your teammate any way you like (email, Telegram, messenger). Once they open it and sign in, access is granted automatically. The link is valid for 14 days."}
      </div>
    </div>
  );
}

// -------------------- Loading / Error placeholders --------------------

function OnboardingSkeleton({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="flex flex-wrap gap-1.5 pt-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-7 rounded-md" />
          ))}
        </div>
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-3 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-32" />
        </CardContent>
      </Card>
      <p className="flex items-center gap-2 text-center text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {label}
      </p>
    </div>
  );
}

function OnboardingError({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <Card className="mx-auto max-w-2xl border-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          Помилка завантаження
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onRetry} disabled={retrying} size="sm">
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
          Спробувати ще раз
        </Button>
      </CardContent>
    </Card>
  );
}

function slugify(input: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z",
    и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
    р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
    ь: "", ю: "iu", я: "ia", "'": "", "`": "", "ʼ": "",
  };
  return (
    input
      .toLowerCase()
      .split("")
      .map((c) => map[c] ?? c)
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || `brand-${Math.random().toString(36).slice(2, 8)}`
  );
}

function CreateFirstTenant({
  lang,
  qc,
  navigate,
}: {
  lang: Lang;
  qc: QC;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("not_authenticated");
      const cleanName = name.trim();
      if (cleanName.length < 2) {
        throw new Error(lang === "ua" ? "Назва занадто коротка" : "Name too short");
      }
      let baseSlug = (slug || slugify(cleanName)).trim().toLowerCase();
      if (!baseSlug) baseSlug = slugify(cleanName);
      let attempt = baseSlug;
      for (let i = 0; i < 4; i++) {
        const { data, error } = await supabase
          .from("tenants")
          .insert({ name: cleanName, slug: attempt, owner_user_id: user.id, status: "active" })
          .select("id, slug")
          .single();
        if (!error && data) return data;
        if (error && /duplicate|unique/i.test(error.message)) {
          attempt = `${baseSlug}-${Math.random().toString(36).slice(2, 5)}`;
          continue;
        }
        if (error) throw error;
      }
      throw new Error(
        lang === "ua" ? "Не вдалось підібрати унікальний slug" : "Couldn't pick a unique slug",
      );
    },
    onSuccess: (data) => {
      toast.success(lang === "ua" ? "Бізнес створено ✓" : "Business created ✓");
      qc.invalidateQueries({ queryKey: ["my-tenants"] });
      navigate({
        to: "/onboarding",
        search: { tenant: data.id, slug: data.slug },
        replace: true,
      });
    },
    onError: (e: Error) =>
      toast.error(e.message || (lang === "ua" ? "Помилка створення" : "Failed to create")),
  });

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {lang === "ua" ? "Створіть свій бізнес" : "Create your business"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {lang === "ua"
            ? "Це займе хвилину. Все можна змінити пізніше."
            : "This takes a minute. You can change anything later."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{lang === "ua" ? "Назва бізнесу" : "Business name"}</CardTitle>
          <CardDescription>
            {lang === "ua"
              ? "Як ваш бренд бачитимуть клієнти. Наприклад, Кавовий Рай."
              : "How customers see your brand. E.g. Sunrise Coffee."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="biz-name">{lang === "ua" ? "Назва" : "Name"}</Label>
            <Input
              id="biz-name"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                if (!touched) setSlug(slugify(e.target.value));
              }}
              placeholder={lang === "ua" ? "Кавовий Рай" : "Sunrise Coffee"}
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="biz-slug">
              {lang === "ua" ? "Адреса вітрини" : "Storefront URL"}
            </Label>
            <div className="flex items-center gap-1 rounded-md border bg-muted/30 px-2 py-1.5 text-sm">
              <span className="text-muted-foreground">/s/</span>
              <Input
                id="biz-slug"
                value={slug}
                onChange={(e) => {
                  setTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                }}
                placeholder="kavoviy-ray"
                maxLength={48}
                className="h-7 border-0 bg-transparent px-1 focus-visible:ring-0"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {lang === "ua"
                ? "Лише латиниця, цифри та дефіс. Має бути унікальною."
                : "Latin letters, digits and dashes only. Must be unique."}
            </p>
          </div>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || name.trim().length < 2}
            className="w-full"
          >
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {lang === "ua" ? "Створити бізнес" : "Create business"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
