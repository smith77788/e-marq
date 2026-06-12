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
import { ensureAuthenticatedSession } from "@/lib/auth/ensureSession";
import { useAuth } from "@/hooks/useAuth";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useT, type TKey, type Lang } from "@/lib/i18n";
import { withTimeout } from "@/lib/async/withTimeout";

type Search = { tenant?: string; slug?: string };
const UI_QUERY_TIMEOUT_MS = 10_000;
const UI_MUTATION_TIMEOUT_MS = 12_000;

function actionTimeoutMessage(action: string) {
  return `${action} триває занадто довго. Перевірте інтернет і натисніть кнопку ще раз.`;
}

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
  const { setCurrentTenantId } = useTenantContext();
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

  // Auto-select only a tenant the current user can actually see.
  // Після створення бізнес одразу інжектиться в cache нижче, тому тут більше
  // не треба довіряти tenant з URL/localStorage. Інакше stale/foreign tenant_id
  // веде до not_authorized на кожному наступному кроці wizard-а.
  const urlTenantIsMine = !!search.tenant && !!tenants?.some((t) => t.id === search.tenant);
  const tenantId = urlTenantIsMine ? search.tenant : tenants?.[0]?.id;
  const tenantSlug = tenants?.find((t) => t.id === tenantId)?.slug;

  useEffect(() => {
    if (tenantId) setCurrentTenantId(tenantId);
  }, [setCurrentTenantId, tenantId]);

  useEffect(() => {
    if ((!search.tenant || !urlTenantIsMine) && tenantId && tenantSlug) {
      navigate({
        to: "/onboarding",
        search: { tenant: tenantId, slug: tenantSlug },
        replace: true,
      });
    }
  }, [search.tenant, tenantId, tenantSlug, urlTenantIsMine, navigate]);

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
      const settled = await withTimeout(
        Promise.allSettled([
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
          supabase
            .from("tenant_configs")
            .select("features, owner_telegram_chat_id")
            .eq("tenant_id", tenantId)
            .maybeSingle(),
          supabase
            .from("telegram_chat_routing")
            .select("chat_id", { count: "exact", head: true })
            .eq("tenant_id", tenantId),
          supabase
            .from("tenant_memberships")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId),
          supabase
            .from("events")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
          supabase
            .from("tenant_invitations")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("status", "pending"),
        ]),
        UI_QUERY_TIMEOUT_MS,
        actionTimeoutMessage("Оновлення статусів onboarding"),
      );
      const pick = <T,>(i: number): T | null =>
        settled[i]?.status === "fulfilled" ? (settled[i] as PromiseFulfilledResult<T>).value : null;
      const tn = pick<{ data: { name: string } | null; error: Error | null }>(0);
      const prod = pick<{ count: number | null; error: Error | null }>(1);
      const cust = pick<{ count: number | null; error: Error | null }>(2);
      const cfg = pick<{
        data: { features?: unknown; owner_telegram_chat_id?: string | null } | null;
        error: Error | null;
      }>(3);
      const tg = pick<{ count: number | null; error: Error | null }>(4);
      const mem = pick<{ count: number | null; error: Error | null }>(5);
      const ev = pick<{ count: number | null; error: Error | null }>(6);
      const inv = pick<{ count: number | null; error: Error | null }>(7);
      // Tolerate partial failures: a brand-new tenant may have RLS races where
      // one of these helper tables hasn't yet been seeded with rows the user can
      // see. We log unexpected errors but never block the wizard — a missing
      // count just means "this step isn't done yet", not "loading failed".
      const errs = [
        tn?.error,
        prod?.error,
        cust?.error,
        cfg?.error,
        tg?.error,
        mem?.error,
        ev?.error,
        inv?.error,
      ]
        .filter(Boolean)
        .map((e) => e!.message);
      if (errs.length > 0) {
        console.warn("[onboarding-status] partial errors:", errs);
      }
      const features = (cfg?.data?.features ?? {}) as Record<string, unknown>;
      const ownerTelegramBound = !!cfg?.data?.owner_telegram_chat_id;
      const trackingDone = !!features.tracking_installed || (ev?.count ?? 0) > 0;
      return {
        s1: !!(tn?.data?.name && tn.data.name.trim().length > 1),
        s2: ownerTelegramBound || (tg?.count ?? 0) > 0,
        s3: (prod?.count ?? 0) > 0,
        s4: (cust?.count ?? 0) > 0,
        s5: trackingDone,
        s6: typeof features.payment_method === "string",
        s7: (mem?.count ?? 0) > 1 || (inv?.count ?? 0) > 0,
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
      render: () => <Step5Tracking tenantId={tenantId} tenantSlug={tenantSlug} qc={qc} />,
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
      await withTimeout(
        ensureAuthenticatedSession(),
        UI_QUERY_TIMEOUT_MS,
        actionTimeoutMessage("Відновлення сесії"),
      );
      const { error } = await withTimeout(
        supabase.from("tenants").update({ name }).eq("id", tenantId),
        UI_MUTATION_TIMEOUT_MS,
        actionTimeoutMessage("Збереження назви бізнесу"),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("common.save") + " ✓");
      qc.invalidateQueries({ queryKey: ["tenant", tenantId] });
      qc.invalidateQueries({ queryKey: ["my-tenants"] });
      qc.invalidateQueries({ queryKey: ["my-tenants-rpc"] });
      qc.invalidateQueries({ queryKey: ["onboarding-status", tenantId] });
      qc.invalidateQueries({ queryKey: ["setup-checklist", tenantId] });
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

function Step2Channel({ tenantId, qc }: { tenantId: string; qc: QC }) {
  const [ownerPairingCode, setOwnerPairingCode] = useState<string | null>(null);
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
  const { data: ownerBinding } = useQuery({
    queryKey: ["onboarding-owner-tg-binding", tenantId],
    retry: 2,
    staleTime: 5_000,
    queryFn: async () => {
      const [cfgRes, pairingRes] = await withTimeout(
        Promise.allSettled([
          supabase
            .from("tenant_configs")
            .select("owner_telegram_chat_id")
            .eq("tenant_id", tenantId)
            .maybeSingle(),
          supabase
            .from("telegram_owner_pairings")
            .select("pairing_code, expires_at")
            .eq("tenant_id", tenantId)
            .is("consumed_at", null)
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]),
        UI_QUERY_TIMEOUT_MS,
        actionTimeoutMessage("Перевірка Telegram-підключення"),
      );
      const cfg = cfgRes.status === "fulfilled" ? cfgRes.value.data : null;
      const pairing = pairingRes.status === "fulfilled" ? pairingRes.value.data : null;
      return { chatId: cfg?.owner_telegram_chat_id ?? null, pairing: pairing ?? null };
    },
  });
  const createOwnerPairing = useMutation({
    mutationFn: async () => {
      await withTimeout(
        ensureAuthenticatedSession(),
        UI_QUERY_TIMEOUT_MS,
        actionTimeoutMessage("Відновлення сесії"),
      );
      const { data, error } = await withTimeout(
        supabase.rpc("create_telegram_owner_pairing", { _tenant_id: tenantId }),
        UI_MUTATION_TIMEOUT_MS,
        actionTimeoutMessage("Створення Telegram-коду"),
      );
      if (error) throw error;
      const pairing = data as { pairing_code?: string } | null;
      return String(pairing?.pairing_code ?? "");
    },
    onSuccess: (code) => {
      setOwnerPairingCode(code);
      toast.success("Код створено — відкрийте бота або скопіюйте команду.");
      qc.invalidateQueries({ queryKey: ["onboarding-owner-tg-binding", tenantId] });
      qc.invalidateQueries({ queryKey: ["onboarding-status", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const activeOwnerCode = ownerPairingCode ?? ownerBinding?.pairing?.pairing_code ?? null;
  const ownerCommand = activeOwnerCode ? `/start owner ${activeOwnerCode}` : "";
  const ownerDeepLink = activeOwnerCode
    ? `https://t.me/Oauther_bot?start=owner_${activeOwnerCode}`
    : "";

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
      <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        {ownerBinding?.chatId ? (
          <div className="text-success">✅ Telegram власника підключено.</div>
        ) : (
          <div className="space-y-2">
            <div>
              Для сповіщень власника створіть одноразовий код і відкрийте @Oauther_bot. Старий
              формат <code>/start owner slug</code> більше не працює з міркувань безпеки.
            </div>
            {ownerCommand && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1">
                <code className="min-w-0 flex-1 truncate font-mono text-foreground">
                  {ownerCommand}
                </code>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(ownerCommand)
                      .then(() => toast.success("Скопійовано"))
                  }
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {ownerDeepLink ? (
                <Button size="sm" asChild>
                  <a href={ownerDeepLink} target="_blank" rel="noreferrer">
                    Відкрити бота як власник →
                  </a>
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => createOwnerPairing.mutate()}
                  disabled={createOwnerPairing.isPending}
                >
                  {createOwnerPairing.isPending && (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  )}
                  Створити код власника
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  qc.invalidateQueries({ queryKey: ["onboarding-owner-tg-binding", tenantId] })
                }
              >
                Перевірити підключення
              </Button>
            </div>
          </div>
        )}
      </div>
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
      await withTimeout(
        ensureAuthenticatedSession(),
        UI_QUERY_TIMEOUT_MS,
        actionTimeoutMessage("Відновлення сесії"),
      );
      const priceCents = parseLocalizedPriceCents(price);
      const stockNum = Math.max(0, parseInt(stock || "0", 10));
      if (!name || !Number.isFinite(priceCents) || priceCents <= 0)
        throw new Error("Заповніть назву та ціну");
      const { error } = await withTimeout(
        supabase.rpc("create_onboarding_product", {
          _tenant_id: tenantId,
          _name: name,
          _price_cents: priceCents,
          _stock: stockNum,
        }),
        UI_MUTATION_TIMEOUT_MS,
        actionTimeoutMessage("Створення товару"),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Готово · товар створено");
      setName("");
      setPrice("");
      setStock("");
      qc.invalidateQueries({ queryKey: ["setup-checklist", tenantId] });
      qc.invalidateQueries({ queryKey: ["onboarding-status", tenantId] });
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
      await withTimeout(
        ensureAuthenticatedSession(),
        UI_QUERY_TIMEOUT_MS,
        actionTimeoutMessage("Відновлення сесії"),
      );
      const rows = parseCustomerCsv(csv);
      if (rows.length === 0) throw new Error("Не знайдено жодного рядка з email");
      const { data, error } = await withTimeout(
        supabase.rpc("import_onboarding_customers", {
          _tenant_id: tenantId,
          _customers: rows,
        }),
        UI_MUTATION_TIMEOUT_MS,
        actionTimeoutMessage("Імпорт клієнтів"),
      );
      if (error) throw error;
      return Number(data ?? rows.length);
    },
    onSuccess: (n) => {
      toast.success(`Готово · додано клієнтів: ${n}`);
      setCsv("");
      qc.invalidateQueries({ queryKey: ["setup-checklist", tenantId] });
      qc.invalidateQueries({ queryKey: ["onboarding-status", tenantId] });
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
          <Link to="/brand/customers" search={{ tenant: tenantId }}>
            {lang === "ua" ? "Всі клієнти" : "All customers"}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Step5Tracking({
  tenantId,
  tenantSlug,
  qc,
}: {
  tenantId: string;
  tenantSlug: string;
  qc: QC;
}) {
  const markInstalled = useMutation({
    mutationFn: async () => {
      await withTimeout(
        ensureAuthenticatedSession(),
        UI_QUERY_TIMEOUT_MS,
        actionTimeoutMessage("Відновлення сесії"),
      );
      const [cfgRes, tenantRes] = await withTimeout(
        Promise.all([
          supabase
            .from("tenant_configs")
            .select("features")
            .eq("tenant_id", tenantId)
            .maybeSingle(),
          supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
        ]),
        UI_QUERY_TIMEOUT_MS,
        actionTimeoutMessage("Перевірка налаштувань бренду"),
      );
      if (cfgRes.error) throw cfgRes.error;
      if (tenantRes.error) throw tenantRes.error;
      const features = {
        ...(((cfgRes.data?.features ?? {}) as Record<string, unknown>) || {}),
        tracking_installed: true,
        tracking_confirmed_at: new Date().toISOString(),
      };
      const query = cfgRes.data
        ? supabase.from("tenant_configs").update({ features }).eq("tenant_id", tenantId)
        : supabase.from("tenant_configs").insert({
            tenant_id: tenantId,
            brand_name: tenantRes.data?.name ?? "Brand",
            features,
          } as never);
      const { error } = await withTimeout(
        query,
        UI_MUTATION_TIMEOUT_MS,
        actionTimeoutMessage("Збереження статусу tracking"),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tracking відмічено як встановлений");
      qc.invalidateQueries({ queryKey: ["onboarding-status", tenantId] });
      qc.invalidateQueries({ queryKey: ["setup-checklist", tenantId] });
      qc.invalidateQueries({ queryKey: ["tenant-config", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <IntegrationGuide tenantSlug={tenantSlug} />
      <Button size="sm" onClick={() => markInstalled.mutate()} disabled={markInstalled.isPending}>
        {markInstalled.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Я вставив
        код на сайт
      </Button>
    </div>
  );
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
    mutationFn: async () => {
      await withTimeout(
        ensureAuthenticatedSession(),
        UI_QUERY_TIMEOUT_MS,
        actionTimeoutMessage("Відновлення сесії"),
      );
      const { error } = await withTimeout(
        supabase.rpc("set_tenant_payment_method", {
          _tenant_id: tenantId,
          _method: "manual",
        }),
        UI_MUTATION_TIMEOUT_MS,
        actionTimeoutMessage("Збереження способу оплати"),
      );
      if (error) throw error;

      const features = (cfg?.features ?? {}) as Record<string, unknown>;
      const payments =
        features.payments &&
        typeof features.payments === "object" &&
        !Array.isArray(features.payments)
          ? (features.payments as Record<string, unknown>)
          : {};
      const { error: configError } = await withTimeout(
        supabase
          .from("tenant_configs")
          .update({
            features: {
              ...features,
              payment_method: "manual",
              payments: {
                ...payments,
                manual_enabled: true,
                currency: typeof payments.currency === "string" ? payments.currency : "UAH",
              },
            },
          })
          .eq("tenant_id", tenantId),
        UI_MUTATION_TIMEOUT_MS,
        actionTimeoutMessage("Збереження налаштувань оплати"),
      );
      if (configError) throw configError;
    },
    onSuccess: () => {
      toast.success(t("common.save") + " ✓");
      qc.invalidateQueries({ queryKey: ["tenant-config", tenantId] });
      qc.invalidateQueries({ queryKey: ["setup-checklist", tenantId] });
      qc.invalidateQueries({ queryKey: ["onboarding-status", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => setMethod.mutate()}
        disabled={setMethod.isPending}
        className={`rounded-md border p-3 text-left text-sm transition-colors ${
          current === "manual" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
        }`}
      >
        <div className="font-medium">{t("onb.s6.manual")}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Працює одразу: клієнт бачить інструкцію з оплати після оформлення замовлення.
        </div>
      </button>
      <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm opacity-80">
        <div className="font-medium">Онлайн-оплата карткою</div>
        <div className="mt-1 text-xs text-muted-foreground">
          LiqPay, WayForPay або monobank підключаються в налаштуваннях бренду після базового
          запуску.
        </div>
      </div>
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
      await withTimeout(
        ensureAuthenticatedSession(),
        UI_QUERY_TIMEOUT_MS,
        actionTimeoutMessage("Відновлення сесії"),
      );
      const trimmed = email.trim().toLowerCase();
      if (!/\S+@\S+\.\S+/.test(trimmed)) {
        throw new Error(
          lang === "ua" ? "Перевірте email — здається, він некоректний." : "Email looks invalid.",
        );
      }
      const { data, error } = await withTimeout(
        supabase.rpc("create_tenant_invitation", {
          _tenant_id: tenantId,
          _email: trimmed,
          _role: "admin",
        }),
        UI_MUTATION_TIMEOUT_MS,
        actionTimeoutMessage("Створення інвайту"),
      );
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
      await withTimeout(
        ensureAuthenticatedSession(),
        UI_QUERY_TIMEOUT_MS,
        actionTimeoutMessage("Відновлення сесії"),
      );
      const { error } = await withTimeout(
        supabase.from("tenant_invitations").delete().eq("id", id),
        UI_MUTATION_TIMEOUT_MS,
        actionTimeoutMessage("Скасування інвайту"),
      );
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
                        onClick={() => revoke.mutate(inv.id)}
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

function parseLocalizedPriceCents(value: string): number {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  return Math.round(Number(normalized) * 100);
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, "").trim());
}

function parseCustomerCsv(csv: string): { email: string; name: string | null }[] {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const header = splitCsvLine(lines[0], delimiter).map((h) => h.toLowerCase());
  // Explicit -1 check: Math.max(findIndex, 0) silently used column 0 (usually
  // "name") as the email column when no email header existed, so every row
  // failed RPC validation with an opaque "no_valid_customers" error.
  const emailIdx = header.findIndex((h) => h.includes("email") || h.includes("e-mail"));
  if (emailIdx === -1) {
    throw new Error('CSV має містити колонку "email" (або "e-mail")');
  }
  const nameIdx = header.findIndex((h) =>
    ["name", "імʼя", "ім'я", "імя", "піб", "customer"].some((k) => h.includes(k)),
  );
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  return lines
    .slice(1)
    .map((line) => {
      const cells = splitCsvLine(line, delimiter);
      const email = (cells[emailIdx] ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return null;
      const name = nameIdx >= 0 ? (cells[nameIdx] ?? "").trim() : "";
      return { email, name: name || null };
    })
    .filter(Boolean) as { email: string; name: string | null }[];
}

function slugify(input: string): string {
  const map: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "h",
    ґ: "g",
    д: "d",
    е: "e",
    є: "ie",
    ж: "zh",
    з: "z",
    и: "y",
    і: "i",
    ї: "i",
    й: "i",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "kh",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    ь: "",
    ю: "iu",
    я: "ia",
    "'": "",
    "`": "",
    ʼ: "",
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
  const { setCurrentTenantId } = useTenantContext();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);

  const create = useMutation({
    mutationFn: async () => {
      await withTimeout(
        ensureAuthenticatedSession(),
        UI_QUERY_TIMEOUT_MS,
        actionTimeoutMessage("Відновлення сесії"),
      );
      const cleanName = name.trim();
      if (cleanName.length < 2) {
        throw new Error(lang === "ua" ? "Назва занадто коротка" : "Name too short");
      }
      let baseSlug = (slug || slugify(cleanName)).trim().toLowerCase();
      if (!baseSlug) baseSlug = slugify(cleanName);
      let attempt = baseSlug;
      for (let i = 0; i < 4; i++) {
        // Use SECURITY DEFINER RPC so RLS edge cases (auth.uid mismatches,
        // trigger ordering) cannot block creation. Function lives in DB.
        const { data, error } = await withTimeout(
          supabase.rpc("create_my_tenant", {
            _name: cleanName,
            _slug: attempt,
          }),
          UI_MUTATION_TIMEOUT_MS,
          actionTimeoutMessage("Створення бізнесу"),
        );
        if (!error && data) {
          const row = Array.isArray(data) ? data[0] : data;
          return { id: row.id as string, slug: row.slug as string };
        }
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
      setCurrentTenantId(data.id);
      try {
        window.localStorage.setItem("marq.activeTenantId", data.id);
      } catch {
        /* ignore */
      }
      // Optimistically inject the new tenant into both caches so the wizard
      // can render Step 1 immediately without waiting for refetch.
      qc.setQueriesData<{ id: string; name: string; slug: string }[] | undefined>(
        { queryKey: ["my-tenants"] },
        (prev) => {
          const next = prev ?? [];
          if (next.some((t) => t.id === data.id)) return next;
          return [{ id: data.id, name: name.trim(), slug: data.slug }, ...next];
        },
      );
      qc.setQueriesData<
        | Array<{
            tenant_id: string;
            tenant_name: string;
            tenant_slug: string;
            membership_role: string;
            plan_key: string;
            plan_name: string;
            status: string;
          }>
        | undefined
      >({ queryKey: ["my-tenants-rpc"] }, (prev) => {
        const next = prev ?? [];
        if (next.some((t) => t.tenant_id === data.id)) return next;
        return [
          {
            tenant_id: data.id,
            tenant_name: name.trim(),
            tenant_slug: data.slug,
            membership_role: "owner",
            plan_key: "free",
            plan_name: "Free",
            status: "active",
          },
          ...next,
        ];
      });
      qc.invalidateQueries({ queryKey: ["my-tenants"] });
      qc.invalidateQueries({ queryKey: ["my-tenants-rpc"] });
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
            <Label htmlFor="biz-slug">{lang === "ua" ? "Адреса вітрини" : "Storefront URL"}</Label>
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
