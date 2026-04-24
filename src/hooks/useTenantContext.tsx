/**
 * Global tenant context.
 *
 * - `tenants` — лише бренди, де користувач є членом (через RPC get_my_tenants).
 *   Це і є його "Мої бренди" — те, чим він володіє або куди його запросили.
 * - `allTenantsForAdmin` — окремий список УСІХ tenants системи, доступний лише
 *   супер-адмінам для адмінських сторінок (Cross-tenant, Lead Radar тощо).
 *   НЕ змішується з `tenants`, щоб у дашборді й перемикачі бренду супер-адмін
 *   бачив лише свої бренди, а не всі чужі.
 * - currentTenantId синхронізується з ?tenant=... та localStorage.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type MyTenant = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  membership_role: string;
  plan_key: string;
  plan_name: string;
  status: string;
};

type Ctx = {
  /** Бренди користувача (мої). Для всіх ролей — лише ті, де є membership. */
  tenants: MyTenant[];
  /** Окремий список УСІХ tenants для супер-адмінських інструментів. */
  allTenantsForAdmin: MyTenant[];
  currentTenantId: string | null;
  current: MyTenant | null;
  setCurrentTenantId: (id: string) => void;
  loading: boolean;
};

const TenantCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "marq.activeTenantId";

export function TenantContextProvider({ children }: { children: ReactNode }) {
  const { user, isSuperAdmin } = useAuth();
  const [currentTenantId, _setCurrent] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  const tenantsQuery = useQuery({
    queryKey: ["my-tenants-rpc", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_tenants");
      if (error) throw error;
      return (data ?? []) as MyTenant[];
    },
  });

  // Окремий запит для адмінів — повний список tenants системи. Використовується
  // лише в адмінських інструментах (cross-tenant, lead radar). НЕ зливається
  // з `tenants` — інакше супер-адмін бачив би в перемикачі бренду чужі магазини.
  const adminAllTenantsQuery = useQuery({
    queryKey: ["all-tenants-for-admin"],
    enabled: !!user && isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, status")
        .order("name");
      if (error) throw error;
      return (data ?? []).map<MyTenant>((t) => ({
        tenant_id: t.id,
        tenant_name: t.name,
        tenant_slug: t.slug,
        membership_role: "super_admin",
        plan_key: "—",
        plan_name: "Admin",
        status: t.status,
      }));
    },
  });

  const tenants = useMemo(() => tenantsQuery.data ?? [], [tenantsQuery.data]);
  const allTenantsForAdmin = useMemo(
    () => adminAllTenantsQuery.data ?? [],
    [adminAllTenantsQuery.data],
  );

  // Auto-select first tenant if nothing chosen yet, or if stored id is not in list.
  useEffect(() => {
    if (tenantsQuery.isLoading) return;
    if (tenants.length === 0) return;
    if (!currentTenantId || !tenants.find((t) => t.tenant_id === currentTenantId)) {
      const next = tenants[0].tenant_id;
      _setCurrent(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
    }
  }, [tenants, currentTenantId, tenantsQuery.isLoading]);

  const setCurrentTenantId = useCallback((id: string) => {
    _setCurrent(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const current = useMemo(
    () => tenants.find((t) => t.tenant_id === currentTenantId) ?? null,
    [tenants, currentTenantId],
  );

  const value = useMemo<Ctx>(
    () => ({
      tenants,
      allTenantsForAdmin,
      currentTenantId,
      current,
      setCurrentTenantId,
      loading: tenantsQuery.isLoading,
    }),
    [
      tenants,
      allTenantsForAdmin,
      currentTenantId,
      current,
      setCurrentTenantId,
      tenantsQuery.isLoading,
    ],
  );

  return <TenantCtx.Provider value={value}>{children}</TenantCtx.Provider>;
}

export function useTenantContext() {
  const ctx = useContext(TenantCtx);
  if (!ctx) throw new Error("useTenantContext must be inside TenantContextProvider");
  return ctx;
}
