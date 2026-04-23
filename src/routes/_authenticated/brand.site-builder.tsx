/**
 * Brand → Site Builder (Sprint 11, етапи 11.1–11.4).
 *
 * Власник бренду створює профіль під шаблон MARQ ("mfd") та переглядає
 * історію згенерованих ZIP-архівів. Сама генерація живого ZIP буде підключена
 * на етапі 11.5 — до того кнопка «Згенерувати» показує дружній toast.
 *
 * Структура:
 *   1. Hero з вибраним шаблоном (поки тільки "mfd") + кнопка-прев'ю.
 *   2. Tabs: Бренд / Тема / Контент / Білди.
 *   3. CTA «Зберегти зміни» + «Згенерувати сайт» (sticky).
 *
 * Безпека: всі queries скоупимо по tenant_id; жодних супер-адмінських
 * звернень з клієнта. Профіль зберігаємо upsert-ом, RLS гарантує що чужі
 * тенанти не пройдуть.
 */
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useT, type TKey } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/brand/site-builder")({
  validateSearch: (s: Record<string, unknown>): { tenant?: string } => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: BrandSiteBuilderPage,
});

type SiteTemplate = {
  id: string;
  template_key: string;
  name: string;
  description: string | null;
  preview_url: string | null;
  is_active: boolean;
};

type SiteBrandProfile = {
  id: string;
  tenant_id: string;
  template_id: string;
  brand_name: string;
  tagline: string | null;
  description: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
  primary_color: string;
  accent_color: string;
  font_family: string;
  contact_email: string | null;
  contact_phone: string | null;
  social_links: Record<string, unknown>;
  custom_domain: string | null;
  locale: string;
  currency: string;
  legal_entity: string | null;
  address: string | null;
  hero_copy: string | null;
  about_copy: string | null;
  legal_pages: Record<string, unknown>;
};

type SiteBuild = {
  id: string;
  status: "queued" | "building" | "ready" | "failed" | "cancelled";
  archive_path: string | null;
  archive_size_bytes: number | null;
  archive_sha256: string | null;
  error: string | null;
  created_at: string;
};

type ProfileDraft = {
  brand_name: string;
  tagline: string;
  description: string;
  logo_url: string;
  favicon_url: string;
  og_image_url: string;
  primary_color: string;
  accent_color: string;
  font_family: string;
  contact_email: string;
  contact_phone: string;
  custom_domain: string;
  locale: string;
  currency: string;
  legal_entity: string;
  address: string;
  hero_copy: string;
  about_copy: string;
};

const FONT_OPTIONS = ["Inter", "Manrope", "Outfit", "DM Sans", "Plus Jakarta Sans"] as const;
const LOCALE_OPTIONS = ["ua", "en"] as const;
const CURRENCY_OPTIONS = ["UAH", "USD", "EUR"] as const;

function emptyDraft(brandName: string): ProfileDraft {
  return {
    brand_name: brandName,
    tagline: "",
    description: "",
    logo_url: "",
    favicon_url: "",
    og_image_url: "",
    primary_color: "oklch(0.55 0.18 260)",
    accent_color: "oklch(0.72 0.15 200)",
    font_family: "Inter",
    contact_email: "",
    contact_phone: "",
    custom_domain: "",
    locale: "ua",
    currency: "UAH",
    legal_entity: "",
    address: "",
    hero_copy: "",
    about_copy: "",
  };
}

function profileToDraft(p: SiteBrandProfile): ProfileDraft {
  return {
    brand_name: p.brand_name,
    tagline: p.tagline ?? "",
    description: p.description ?? "",
    logo_url: p.logo_url ?? "",
    favicon_url: p.favicon_url ?? "",
    og_image_url: p.og_image_url ?? "",
    primary_color: p.primary_color,
    accent_color: p.accent_color,
    font_family: p.font_family,
    contact_email: p.contact_email ?? "",
    contact_phone: p.contact_phone ?? "",
    custom_domain: p.custom_domain ?? "",
    locale: p.locale,
    currency: p.currency,
    legal_entity: p.legal_entity ?? "",
    address: p.address ?? "",
    hero_copy: p.hero_copy ?? "",
    about_copy: p.about_copy ?? "",
  };
}

function BrandSiteBuilderPage() {
  const { tenant: urlTenant } = useSearch({ from: "/_authenticated/brand/site-builder" });
  const { t } = useT();
  const { current, currentTenantId, setCurrentTenantId, tenants, loading } = useTenantContext();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState("profile");

  // 1) Active template (поки лише "mfd")
  const templateQuery = useQuery({
    queryKey: ["site-template", "mfd"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_templates")
        .select("id, template_key, name, description, preview_url, is_active")
        .eq("template_key", "mfd")
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data as SiteTemplate | null;
    },
  });
  const template = templateQuery.data;

  // 2) Brand profile
  const tenantId = urlTenant ?? currentTenantId ?? current?.tenant_id ?? tenants[0]?.tenant_id ?? null;
  const activeTenant = useMemo(
    () =>
      current ??
      tenants.find((tt) => tt.tenant_id === tenantId) ??
      tenants[0] ??
      null,
    [current, tenants, tenantId],
  );
  useEffect(() => {
    if (tenantId && currentTenantId !== tenantId) setCurrentTenantId(tenantId);
  }, [tenantId, currentTenantId, setCurrentTenantId]);
  const profileQuery = useQuery({
    queryKey: ["site-brand-profile", tenantId, template?.id],
    enabled: !!tenantId && !!template?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_brand_profiles")
        .select("*")
        .eq("tenant_id", tenantId!)
        .eq("template_id", template!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as SiteBrandProfile | null;
    },
  });

  // 3) Builds (last 10)
  const buildsQuery = useQuery({
    queryKey: ["site-builds", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_builds")
        .select("id, status, archive_path, archive_size_bytes, archive_sha256, error, created_at")
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as SiteBuild[];
    },
  });

  // 4) Local draft
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  useEffect(() => {
    if (profileQuery.data) {
      setDraft(profileToDraft(profileQuery.data));
    } else if (profileQuery.isFetched && activeTenant) {
      setDraft(emptyDraft(activeTenant.tenant_name));
    }
  }, [profileQuery.data, profileQuery.isFetched, activeTenant]);

  const saveMut = useMutation({
    mutationFn: async (next: ProfileDraft) => {
      if (!tenantId || !template) throw new Error("missing tenant/template");
      if (!next.brand_name.trim()) throw new Error(t("sbu.required"));
      const payload = {
        tenant_id: tenantId,
        template_id: template.id,
        brand_name: next.brand_name.trim(),
        tagline: next.tagline.trim() || null,
        description: next.description.trim() || null,
        logo_url: next.logo_url.trim() || null,
        favicon_url: next.favicon_url.trim() || null,
        og_image_url: next.og_image_url.trim() || null,
        primary_color: next.primary_color.trim() || "oklch(0.55 0.18 260)",
        accent_color: next.accent_color.trim() || "oklch(0.72 0.15 200)",
        font_family: next.font_family || "Inter",
        contact_email: next.contact_email.trim() || null,
        contact_phone: next.contact_phone.trim() || null,
        custom_domain: next.custom_domain.trim() || null,
        locale: next.locale || "ua",
        currency: next.currency || "UAH",
        legal_entity: next.legal_entity.trim() || null,
        address: next.address.trim() || null,
        hero_copy: next.hero_copy.trim() || null,
        about_copy: next.about_copy.trim() || null,
      };
      const { error } = await supabase
        .from("site_brand_profiles")
        .upsert(payload, { onConflict: "tenant_id,template_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("sbu.action.saved"));
      qc.invalidateQueries({ queryKey: ["site-brand-profile", tenantId, template?.id] });
    },
    onError: (e: unknown) => {
      toast.error(t("sbu.action.saveErr"), {
        description: e instanceof Error ? e.message : String(e),
      });
    },
  });

  const generateMut = useMutation({
    mutationFn: async () => {
      if (!tenantId || !template) throw new Error("missing tenant/template");
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated");
      const res = await fetch("/api/site-builder/build", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ tenant_id: tenantId, template_id: template.id }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        download_url?: string;
        error?: string;
      };
      if (!res.ok) {
        if (res.status === 429) throw new Error(t("sbu.action.cooldown"));
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
      return payload as { download_url: string };
    },
    onSuccess: (data) => {
      toast.success(t("sbu.action.buildOk"));
      qc.invalidateQueries({ queryKey: ["site-builds", tenantId] });
      if (data.download_url && typeof window !== "undefined") {
        window.location.href = data.download_url;
      }
    },
    onError: (e: unknown) => {
      toast.error(t("sbu.action.buildErr"), {
        description: e instanceof Error ? e.message : String(e),
      });
    },
  });

  const handleGenerate = async () => {
    void user;
    if (!draft || !draft.brand_name.trim()) {
      toast.info(t("sbu.action.notReady"));
      setTab("profile");
      return;
    }
    // Якщо профілю ще нема або поточний draft відрізняється — зберігаємо.
    const savedDraft = profileQuery.data ? profileToDraft(profileQuery.data) : null;
    const needsSave = !savedDraft || JSON.stringify(savedDraft) !== JSON.stringify(draft);
    if (needsSave) {
      try {
        await saveMut.mutateAsync(draft);
      } catch {
        return; // toast уже показано всередині saveMut.onError
      }
    }
    generateMut.mutate();
  };

  if (loading || (!activeTenant && tenants.length === 0 && (templateQuery.isLoading || profileQuery.isLoading))) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!activeTenant) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("brand.noBrandTitle")}</CardTitle>
          <CardDescription>{t("brand.noBrandDesc")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const isReady = !!draft && !!template;
  const dirty =
    !!draft &&
    !!profileQuery.data &&
    JSON.stringify(draft) !== JSON.stringify(profileToDraft(profileQuery.data));
  const isNew = !!draft && !profileQuery.data;

  return (
    <div className="space-y-6">
      <SiteBuilderHeader template={template} />

      {!isReady ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-96" />
          </CardHeader>
        </Card>
      ) : (
        <>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full max-w-2xl grid-cols-4">
              <TabsTrigger value="profile">{t("sbu.tab.profile")}</TabsTrigger>
              <TabsTrigger value="theme">{t("sbu.tab.theme")}</TabsTrigger>
              <TabsTrigger value="content">{t("sbu.tab.content")}</TabsTrigger>
              <TabsTrigger value="builds">{t("sbu.tab.builds")}</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="mt-4">
              <ProfileTab draft={draft!} setDraft={setDraft} />
            </TabsContent>

            <TabsContent value="theme" className="mt-4">
              <ThemeTab draft={draft!} setDraft={setDraft} />
            </TabsContent>

            <TabsContent value="content" className="mt-4">
              <ContentTab draft={draft!} setDraft={setDraft} />
            </TabsContent>

            <TabsContent value="builds" className="mt-4">
              <BuildsTab builds={buildsQuery.data ?? []} isLoading={buildsQuery.isLoading} />
            </TabsContent>
          </Tabs>

          <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-border bg-background/95 p-3 shadow-sm backdrop-blur">
            {(dirty || isNew) && (
              <Badge variant="outline" className="border-warning/40 text-warning">
                {t("sbu.action.save")}
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={saveMut.isPending || !draft?.brand_name.trim()}
              onClick={() => draft && saveMut.mutate(draft)}
            >
              {saveMut.isPending ? "…" : t("sbu.action.save")}
            </Button>
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={
                !draft?.brand_name.trim() || generateMut.isPending || saveMut.isPending
              }
              className="bg-gradient-primary text-primary-foreground"
            >
              <Wand2 className="mr-2 h-4 w-4" />
              {generateMut.isPending || saveMut.isPending
                ? t("sbu.action.generating")
                : t("sbu.action.generate")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function SiteBuilderHeader({ template }: { template?: SiteTemplate | null }) {
  const { t } = useT();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Wand2 className="h-4 w-4" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("sbu.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("sbu.subtitle")}</p>
        </div>
      </div>

      {template && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  <Badge variant="secondary" className="text-[10px]">
                    <Sparkles className="mr-1 h-3 w-3" />
                    {t("sbu.templateActive")}
                  </Badge>
                </div>
                {template.description && (
                  <CardDescription className="mt-1 max-w-2xl">
                    {template.description}
                  </CardDescription>
                )}
              </div>
              {template.preview_url && (
                <Button asChild variant="outline" size="sm">
                  <a href={template.preview_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {t("sbu.preview")}
                  </a>
                </Button>
              )}
            </div>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

type FieldProps = {
  draft: ProfileDraft;
  setDraft: (next: ProfileDraft | ((d: ProfileDraft | null) => ProfileDraft | null)) => void;
};

function ProfileTab({ draft, setDraft }: FieldProps) {
  const { t } = useT();
  const set = (k: keyof ProfileDraft, v: string) => setDraft({ ...draft, [k]: v });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("sbu.profile.title")}</CardTitle>
        <CardDescription>{t("sbu.profile.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <FieldText
          label={t("sbu.profile.brandName")}
          required
          value={draft.brand_name}
          onChange={(v) => set("brand_name", v)}
        />
        <FieldText
          label={t("sbu.profile.tagline")}
          hint={t("sbu.profile.taglineHint")}
          value={draft.tagline}
          onChange={(v) => set("tagline", v)}
        />
        <FieldArea
          className="md:col-span-2"
          label={t("sbu.profile.description")}
          hint={t("sbu.profile.descriptionHint")}
          value={draft.description}
          onChange={(v) => set("description", v)}
        />
        <FieldText
          label={t("sbu.profile.logo")}
          value={draft.logo_url}
          onChange={(v) => set("logo_url", v)}
          placeholder="https://"
        />
        <FieldText
          label={t("sbu.profile.favicon")}
          value={draft.favicon_url}
          onChange={(v) => set("favicon_url", v)}
          placeholder="https://"
        />
        <FieldText
          label={t("sbu.profile.ogImage")}
          value={draft.og_image_url}
          onChange={(v) => set("og_image_url", v)}
          placeholder="https://"
          className="md:col-span-2"
        />
        <FieldText
          label={t("sbu.profile.contactEmail")}
          value={draft.contact_email}
          onChange={(v) => set("contact_email", v)}
          placeholder="hello@brand.com"
        />
        <FieldText
          label={t("sbu.profile.contactPhone")}
          value={draft.contact_phone}
          onChange={(v) => set("contact_phone", v)}
          placeholder="+380…"
        />
        <FieldText
          label={t("sbu.profile.legal")}
          value={draft.legal_entity}
          onChange={(v) => set("legal_entity", v)}
        />
        <FieldText
          label={t("sbu.profile.address")}
          value={draft.address}
          onChange={(v) => set("address", v)}
        />
        <FieldSelect
          label={t("sbu.profile.locale")}
          value={draft.locale}
          options={LOCALE_OPTIONS as readonly string[]}
          onChange={(v) => set("locale", v)}
        />
        <FieldSelect
          label={t("sbu.profile.currency")}
          value={draft.currency}
          options={CURRENCY_OPTIONS as readonly string[]}
          onChange={(v) => set("currency", v)}
        />
        <FieldText
          label={t("sbu.profile.customDomain")}
          hint={t("sbu.profile.customDomainHint")}
          value={draft.custom_domain}
          onChange={(v) => set("custom_domain", v)}
          placeholder="shop.brand.com"
          className="md:col-span-2"
        />
      </CardContent>
    </Card>
  );
}

function ThemeTab({ draft, setDraft }: FieldProps) {
  const { t } = useT();
  const set = (k: keyof ProfileDraft, v: string) => setDraft({ ...draft, [k]: v });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("sbu.theme.title")}</CardTitle>
        <CardDescription>{t("sbu.theme.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <FieldText
            label={t("sbu.theme.primary")}
            value={draft.primary_color}
            onChange={(v) => set("primary_color", v)}
            placeholder="oklch(0.55 0.18 260)"
          />
          <FieldText
            label={t("sbu.theme.accent")}
            value={draft.accent_color}
            onChange={(v) => set("accent_color", v)}
            placeholder="oklch(0.72 0.15 200)"
          />
          <FieldSelect
            label={t("sbu.theme.font")}
            value={draft.font_family}
            options={FONT_OPTIONS as readonly string[]}
            onChange={(v) => set("font_family", v)}
          />
        </div>

        <Separator />

        <div>
          <Label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
            {t("sbu.theme.preview")}
          </Label>
          <div
            className="rounded-lg border border-border p-6"
            style={{ fontFamily: draft.font_family }}
          >
            <div
              className="mb-3 inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-white"
              style={{ background: draft.primary_color }}
            >
              {draft.brand_name || "Brand"}
            </div>
            <h3 className="text-2xl font-bold" style={{ color: draft.primary_color }}>
              {draft.tagline || "Your tagline"}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {draft.description ||
                "Описання бренду — як вас має сприйняти клієнт у перші 3 секунди."}
            </p>
            <button
              type="button"
              className="mt-4 rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ background: draft.accent_color }}
            >
              CTA Button
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ContentTab({ draft, setDraft }: FieldProps) {
  const { t } = useT();
  const set = (k: keyof ProfileDraft, v: string) => setDraft({ ...draft, [k]: v });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("sbu.content.title")}</CardTitle>
        <CardDescription>{t("sbu.content.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldArea
          label={t("sbu.content.hero")}
          value={draft.hero_copy}
          onChange={(v) => set("hero_copy", v)}
          rows={4}
        />
        <FieldArea
          label={t("sbu.content.about")}
          value={draft.about_copy}
          onChange={(v) => set("about_copy", v)}
          rows={6}
        />
      </CardContent>
    </Card>
  );
}

function BuildsTab({ builds, isLoading }: { builds: SiteBuild[]; isLoading: boolean }) {
  const { t } = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("sbu.builds.title")}</CardTitle>
        <CardDescription>{t("sbu.builds.desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : builds.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t("sbu.builds.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {builds.map((b) => (
              <BuildRow key={b.id} build={b} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BuildRow({ build }: { build: SiteBuild }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const statusKey: TKey = `sbu.builds.status.${build.status}` as TKey;
  const statusVariant =
    build.status === "ready"
      ? "border-success/40 text-success"
      : build.status === "failed"
        ? "border-destructive/40 text-destructive"
        : "border-muted-foreground/30 text-muted-foreground";

  const handleDownload = async () => {
    setBusy(true);
    try {
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated");
      const res = await fetch(`/api/site-builder/download/${build.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await res.json().catch(() => ({}))) as {
        download_url?: string;
        error?: string;
      };
      if (!res.ok || !payload.download_url) {
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
      window.location.href = payload.download_url;
    } catch (err) {
      toast.error(t("sbu.action.buildErr"), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={statusVariant}>
          {t(statusKey)}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">
          {new Date(build.created_at).toLocaleString()}
        </span>
        {build.archive_size_bytes && (
          <span className="text-xs text-muted-foreground">
            · {(build.archive_size_bytes / 1024).toFixed(1)} KB
          </span>
        )}
      </div>
      {build.status === "ready" && build.archive_path ? (
        <Button variant="outline" size="sm" onClick={handleDownload} disabled={busy}>
          {busy ? "…" : t("sbu.builds.download")}
        </Button>
      ) : build.error ? (
        <span className="max-w-md truncate text-xs text-destructive" title={build.error}>
          {build.error}
        </span>
      ) : null}
    </li>
  );
}

function FieldText({
  label,
  value,
  onChange,
  hint,
  placeholder,
  required,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-xs">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FieldArea({
  label,
  value,
  onChange,
  hint,
  rows = 3,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-xs">{label}</Label>
      <Textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FieldSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  const id = useMemo(() => `sel-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <div>
      <Label htmlFor={id} className="mb-1 block text-xs">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
