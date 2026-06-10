/**
 * GlobalSearch — ⌘K / Ctrl+K Command Palette.
 *
 * Searches across:
 *  - Static pages (sidebar nav)
 *  - Products (by name / sku)
 *  - Orders (by order number / customer email)
 *  - Customers (by name / email)
 *  - Recent insights (by title)
 *
 * Server-side debounced query, scoped to tenants the user belongs to (RLS
 * enforces this anyway, but explicit `.in("tenant_id", ...)` keeps queries
 * fast).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Building2,
  Clock,
  Compass,
  Lightbulb,
  Loader2,
  Package,
  Search,
  ShoppingCart,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import { getRecentPages } from "@/lib/recentPages";
import { QUICK_ACTIONS, toggleThemeMode, type QuickAction } from "@/lib/quickActions";
import { AiAskPanel } from "@/components/layout/AiAskPanel";

type StaticEntry = {
  label: string;
  hint: string;
  to: string;
  hash?: string;
  icon: typeof Compass;
};

const PAGES_OWNER: StaticEntry[] = [
  // Дашборд
  { label: "Огляд", hint: "/brand", to: "/brand", icon: Compass },
  { label: "Аналітика", hint: "/dashboard", to: "/dashboard", icon: Compass },
  // Продажі
  { label: "Замовлення", hint: "/brand/orders", to: "/brand/orders", icon: ShoppingCart },
  { label: "Клієнти", hint: "/brand/customers", to: "/brand/customers", icon: Users },
  // Каталог
  { label: "Товари", hint: "/brand/products", to: "/brand/products", icon: Package },
  { label: "Колекції", hint: "/brand/catalog", to: "/brand/catalog", icon: Compass },
  { label: "Акції та знижки", hint: "/brand/promotions", to: "/brand/promotions", icon: Compass },
  // Маркетинг
  { label: "Email-розсилки", hint: "/brand/email", to: "/brand/email", icon: Compass },
  { label: "Конструктор сайту", hint: "/brand/site-builder", to: "/brand/site-builder", icon: Compass },
  // AI-Агенти
  { label: "Інсайти", hint: "/brand/insights", to: "/brand/insights", icon: Lightbulb },
  { label: "Рішення агентів", hint: "/brand/decisions", to: "/brand/decisions", icon: Bot },
  { label: "Автоматизація", hint: "/brand/acos-loop", to: "/brand/acos-loop", icon: Bot },
  { label: "ROI від AI", hint: "/brand/roi", to: "/brand/roi", icon: Compass },
  { label: "Бібліотека агентів", hint: "/agents/library", to: "/agents/library", icon: Bot },
  // Налаштування
  { label: "Канали", hint: "/brand/channels", to: "/brand/channels", icon: Compass },
  { label: "Інтеграції", hint: "/brand/integrations", to: "/brand/integrations", icon: Compass },
  { label: "Команда", hint: "/brand/team", to: "/brand/team", icon: Users },
  { label: "Налаштування магазину", hint: "/brand/settings", to: "/brand/settings", icon: Compass },
  { label: "Тарифний план", hint: "/brand/billing", to: "/brand/billing", icon: Compass },
  { label: "Профіль", hint: "/profile", to: "/profile", icon: Compass },
  { label: "Журнал запитів", hint: "/brand/ingest-logs", to: "/brand/ingest-logs", icon: Compass },
];

const PAGES_ADMIN: StaticEntry[] = [
  // Моніторинг
  { label: "Командний центр", hint: "/admin", to: "/admin", icon: Compass },
  { label: "Health-монітор", hint: "/admin/health", to: "/admin/health", icon: Compass },
  { label: "Самовідновлення", hint: "/admin/self-heal", to: "/admin/self-heal", icon: Compass },
  { label: "Аудит-лог", hint: "/admin/audit-log", to: "/admin/audit-log", icon: Compass },
  { label: "Журнал запитів (адмін)", hint: "/admin/ingest-logs", to: "/admin/ingest-logs", icon: Compass },
  // Управління
  { label: "Усі бренди", hint: "/admin/tenants", to: "/admin/tenants", icon: Building2 },
  { label: "Користувачі", hint: "/admin/users", to: "/admin/users", icon: Users },
  { label: "Права адмінів", hint: "/admin/permissions", to: "/admin/permissions", icon: Compass },
  { label: "Каталог тарифів", hint: "/admin/plans", to: "/admin/plans", icon: Compass },
  { label: "Заявки на оплату", hint: "/admin/topup-requests", to: "/admin/topup-requests", icon: Compass },
  // AI-Агенти (адмін)
  { label: "Команди системи", hint: "/admin/commands", to: "/admin/commands", icon: Compass },
  { label: "Рішення агентів (адмін)", hint: "/admin/decisions", to: "/admin/decisions", icon: Compass },
  { label: "Запуски в ефірі", hint: "/agents/live", to: "/agents/live", icon: Bot },
  { label: "Цикл вимірювань", hint: "/admin/outcomes", to: "/admin/outcomes", icon: Compass },
  { label: "Потік інсайтів", hint: "/admin/overview", to: "/admin/overview", icon: Compass },
  // Лідогенерація
  { label: "Lead Radar", hint: "/admin/lead-radar", to: "/admin/lead-radar", icon: Compass },
  { label: "DN Trade Health", hint: "/admin/dntrade-health", to: "/admin/dntrade-health", icon: Compass },
];

type ProductHit = { id: string; tenant_id: string; name: string; sku: string | null };
type OrderHit = {
  id: string;
  tenant_id: string;
  payment_ref: string | null;
  customer_email: string | null;
  customer_name: string | null;
};
type CustomerHit = {
  id: string;
  tenant_id: string;
  email: string | null;
  name: string | null;
};
type InsightHit = {
  id: string;
  tenant_id: string;
  title: string;
  insight_type: string;
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function GlobalSearch() {
  const { t } = useT();
  const { user, isSuperAdmin } = useAuth();
  const { currentTenantId } = useTenantContext();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 220);
  const isAiMode = query.trimStart().startsWith("?") || query.trimStart().startsWith(">");
  const aiQuestion = isAiMode ? query.trimStart().replace(/^[?>]+\s*/, "") : "";

  // ⌘K / Ctrl+K shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset query when closing
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Deep-link: відкрити палетту з готовим AI-запитом через URL `?ask=...`.
  // Використовується share-кнопкою (AiAskPanel → copy link). Зчитуємо один раз
  // на mount + слухаємо popstate для назад/вперед навігації.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const consumeAskParam = () => {
      const url = new URL(window.location.href);
      const ask = url.searchParams.get("ask");
      if (!ask) return;
      const decoded = ask.trim();
      if (decoded.length < 1) return;
      setQuery(`? ${decoded}`);
      setOpen(true);
      // Clean URL без перезавантаження.
      url.searchParams.delete("ask");
      window.history.replaceState({}, "", url.toString());
    };
    consumeAskParam();
    window.addEventListener("popstate", consumeAskParam);
    return () => window.removeEventListener("popstate", consumeAskParam);
  }, []);

  const { data: tenantIds = [] } = useQuery({
    queryKey: ["gs-tenants", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_memberships")
        .select("tenant_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.tenant_id);
    },
    staleTime: 60_000,
  });

  const enabled = open && !isAiMode && debounced.length >= 2 && tenantIds.length > 0;

  const { data: results, isFetching } = useQuery({
    queryKey: ["gs-results", debounced, tenantIds.join(",")],
    enabled,
    queryFn: async () => {
      const like = `%${debounced.replace(/[%_]/g, "")}%`;
      const [products, orders, customers, insights] = await Promise.all([
        supabase
          .from("products")
          .select("id, tenant_id, name, sku")
          .in("tenant_id", tenantIds)
          .or(`name.ilike.${like},sku.ilike.${like}`)
          .limit(8),
        supabase
          .from("orders")
          .select("id, tenant_id, payment_ref, customer_email, customer_name")
          .in("tenant_id", tenantIds)
          .or(`payment_ref.ilike.${like},customer_email.ilike.${like},customer_name.ilike.${like}`)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("customers")
          .select("id, tenant_id, email, name")
          .in("tenant_id", tenantIds)
          .or(`email.ilike.${like},name.ilike.${like}`)
          .limit(8),
        supabase
          .from("ai_insights")
          .select("id, tenant_id, title, insight_type")
          .in("tenant_id", tenantIds)
          .ilike("title", like)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      return {
        products: (products.data ?? []) as ProductHit[],
        orders: (orders.data ?? []) as OrderHit[],
        customers: (customers.data ?? []) as CustomerHit[],
        insights: (insights.data ?? []) as InsightHit[],
      };
    },
    staleTime: 15_000,
  });

  const pages = useMemo(() => {
    const all = isSuperAdmin ? [...PAGES_ADMIN, ...PAGES_OWNER] : PAGES_OWNER;
    if (debounced.length < 2) return all.slice(0, 8);
    const q = debounced.toLowerCase();
    return all.filter((p) => p.label.toLowerCase().includes(q) || p.hint.toLowerCase().includes(q));
  }, [debounced, isSuperAdmin]);

  // Recent visits — only when palette is open + no active query (idle state).
  const recent = useMemo(() => {
    if (!open || debounced.length >= 2) return [];
    return getRecentPages().slice(0, 5);
  }, [open, debounced]);

  // Quick actions — Linear/Raycast-style. Filtered by query + admin flag.
  const quickActions = useMemo(() => {
    const visible = QUICK_ACTIONS.filter((a) => !a.requiresSuperAdmin || isSuperAdmin);
    if (debounced.length < 2) return visible.slice(0, 6);
    const q = debounced.toLowerCase();
    return visible.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.hint.toLowerCase().includes(q) ||
        (a.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
    );
  }, [debounced, isSuperAdmin]);

  const go = useCallback(
    (to: string, hash?: string) => {
      setOpen(false);
      // Use type-cast: string→registered-route is too narrow for our dynamic list.
      void navigate({ to: to as never, hash });
    },
    [navigate],
  );

  const runQuickAction = useCallback(
    (a: QuickAction) => {
      if (a.kind === "nav" && a.to) {
        go(a.to, a.hash);
        return;
      }
      if (a.kind === "fx") {
        if (a.fx === "toggle-theme") {
          toggleThemeMode();
        } else if (a.fx === "reload") {
          if (typeof window !== "undefined") window.location.reload();
        }
        setOpen(false);
      }
    },
    [go],
  );

  const showResults = debounced.length >= 2;
  const hasAnyResult =
    showResults &&
    !!results &&
    results.products.length +
      results.orders.length +
      results.customers.length +
      results.insights.length >
      0;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="hidden h-9 gap-2 px-2.5 text-xs text-muted-foreground sm:flex"
        onClick={() => setOpen(true)}
        aria-label={t("gs.openLabel")}
        aria-keyshortcuts="Meta+K Control+K"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden md:inline">{t("gs.placeholder")}</span>
        <kbd
          aria-hidden="true"
          className="ml-1 hidden items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono md:inline-flex"
        >
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 sm:hidden"
        onClick={() => setOpen(true)}
        aria-label={t("gs.openLabel")}
        aria-keyshortcuts="Meta+K Control+K"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={!isAiMode}>
        <CommandInput
          placeholder={t("gs.inputPlaceholder")}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {isAiMode && (
            <AiAskPanel
              tenantId={currentTenantId}
              question={aiQuestion}
              onNavigate={(to) => go(to)}
              onPickQuestion={(q) => setQuery(q ? `? ${q}` : "? ")}
            />
          )}

          {!isAiMode && isFetching && showResults && (
            <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              {t("gs.searching")}
            </div>
          )}

          {!isAiMode && showResults && !isFetching && !hasAnyResult && pages.length === 0 && (
            <CommandEmpty>{t("gs.noResults")}</CommandEmpty>
          )}

          {!isAiMode && recent.length > 0 && (
            <CommandGroup heading={t("gs.groupRecent")}>
              {recent.map((r) => (
                <CommandItem
                  key={`recent::${r.path}`}
                  value={`recent::${r.label}::${r.path}`}
                  onSelect={() => go(r.path)}
                >
                  <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{r.label}</span>
                  <span className="ml-2 truncate text-[10px] text-muted-foreground">{r.path}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!isAiMode && quickActions.length > 0 && (
            <>
              {recent.length > 0 && <CommandSeparator />}
              <CommandGroup heading={t("gs.groupActions")}>
                {quickActions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <CommandItem
                      key={a.id}
                      value={`action::${a.label}::${(a.keywords ?? []).join(" ")}`}
                      onSelect={() => runQuickAction(a)}
                    >
                      <Icon className="mr-2 h-4 w-4 text-primary" />
                      <span className="flex-1 truncate">{a.label}</span>
                      <span className="ml-2 truncate text-[10px] text-muted-foreground">
                        {a.hint}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}

          {!isAiMode && pages.length > 0 && (
            <>
              {(recent.length > 0 || quickActions.length > 0) && <CommandSeparator />}
              <CommandGroup heading={t("gs.groupPages")}>
                {pages.map((p) => {
                  const Icon = p.icon;
                  return (
                    <CommandItem
                      key={p.to + (p.hash ?? "")}
                      value={`page::${p.label}::${p.hint}`}
                      onSelect={() => go(p.to, p.hash)}
                    >
                      <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 truncate">{p.label}</span>
                      <span className="ml-2 truncate text-[10px] text-muted-foreground">
                        {p.hint}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}

          {!isAiMode && showResults && results && results.products.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("gs.groupProducts")}>
                {results.products.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`product::${p.id}::${p.name}`}
                    onSelect={() => go(`/brand/products/${p.id}`)}
                  >
                    <Package className="mr-2 h-4 w-4 text-info" />
                    <span className="flex-1 truncate">{p.name}</span>
                    {p.sku && (
                      <span className="ml-2 truncate text-[10px] text-muted-foreground">
                        {p.sku}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {!isAiMode && showResults && results && results.orders.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("gs.groupOrders")}>
                {results.orders.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={`order::${o.id}`}
                    onSelect={() => go("/brand/orders")}
                  >
                    <ShoppingCart className="mr-2 h-4 w-4 text-warning" />
                    <span className="flex-1 truncate">
                      {o.payment_ref ? `#${o.payment_ref}` : `#${o.id.slice(0, 8)}`}
                    </span>
                    <span className="ml-2 truncate text-[10px] text-muted-foreground">
                      {o.customer_name ?? o.customer_email ?? ""}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {!isAiMode && showResults && results && results.customers.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("gs.groupCustomers")}>
                {results.customers.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`customer::${c.id}`}
                    onSelect={() => go("/brand", "customers")}
                  >
                    <Users className="mr-2 h-4 w-4 text-info" />
                    <span className="flex-1 truncate">{c.name ?? c.email ?? c.id.slice(0, 8)}</span>
                    {c.email && (
                      <span className="ml-2 truncate text-[10px] text-muted-foreground">
                        {c.email}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {!isAiMode && showResults && results && results.insights.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("gs.groupInsights")}>
                {results.insights.map((i) => (
                  <CommandItem
                    key={i.id}
                    value={`insight::${i.id}::${i.title}`}
                    onSelect={() => go("/brand", "insights")}
                  >
                    <Lightbulb className="mr-2 h-4 w-4 text-warning" />
                    <span className="flex-1 truncate">{i.title}</span>
                    <span className="ml-2 truncate text-[10px] text-muted-foreground">
                      {i.insight_type}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {!isAiMode && !showResults && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              {t("gs.tipMinChars")}
              <span className="mt-1 block text-primary/80">{t("gs.aiTriggerHint")}</span>
            </div>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
