/**
 * Global tenant context.
 * - Lists all tenants the current user is a member of (via get_my_tenants RPC).
 * - For super-admin without memberships, falls back to ALL tenants from the
 *   tenants table so they can immediately operate on any brand.
 * - Tracks the currently selected tenant; persists in localStorage and syncs
 *   with the ?tenant=... query param when on /brand or /onboarding.
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
  tenants: MyTenant[];
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

  // Fallback for super-admins: if they don't have any memberships yet, show
  // every tenant so they can manage brands without joining each one manually.
  const adminFallbackQuery = useQuery({
    queryKey: ["admin-tenant-fallback"],
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

  const tenants = useMemo(() => {
    const own = tenantsQuery.data ?? [];
    const fallback = isSuperAdmin ? (adminFallbackQuery.data ?? []) : [];
    if (own.length === 0) return fallback;
    if (fallback.length === 0) return own;
    // Merge: own memberships first (priority), then fallback tenants the user
    // is not yet a member of. Super-admins who also own a brand see their own
    // brand as the default — not the alphabetically-first tenant.
    const ownIds = new Set(own.map((t) => t.tenant_id));
    const extra = fallback.filter((t) => !ownIds.has(t.tenant_id));
    return [...own, ...extra];
  }, [tenantsQuery.data, adminFallbackQuery.data, isSuperAdmin]);

  // Auto-select first tenant if nothing chosen yet, or if stored id is not in list.
  // Wait for the membership query to settle before auto-picking so super-admins
  // who own a brand don't briefly land on an alphabetically-first fallback tenant.
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
      currentTenantId,
      current,
      setCurrentTenantId,
      loading: tenantsQuery.isLoading || (isSuperAdmin && adminFallbackQuery.isLoading),
    }),
    [
      tenants,
      currentTenantId,
      current,
      setCurrentTenantId,
      tenantsQuery.isLoading,
      adminFallbackQuery.isLoading,
      isSuperAdmin,
    ],
  );

  return <TenantCtx.Provider value={value}>{children}</TenantCtx.Provider>;
}

export function useTenantContext() {
  const ctx = useContext(TenantCtx);
  if (!ctx) throw new Error("useTenantContext must be inside TenantContextProvider");
  return ctx;
}
