/**
 * Global tenant context.
 * - Lists all tenants the current user is a member of (via get_my_tenants RPC).
 * - Tracks the currently selected tenant; persists in localStorage and syncs
 *   with the ?tenant=... query param when on /brand or /onboarding.
 * - Used by TenantSwitcher and any component that needs the active tenant.
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
  const { user } = useAuth();
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

  const tenants = useMemo(() => tenantsQuery.data ?? [], [tenantsQuery.data]);

  // Auto-select first tenant if nothing chosen yet, or if stored id is not in list
  useEffect(() => {
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
  }, [tenants, currentTenantId]);

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
      loading: tenantsQuery.isLoading,
    }),
    [tenants, currentTenantId, current, setCurrentTenantId, tenantsQuery.isLoading],
  );

  return <TenantCtx.Provider value={value}>{children}</TenantCtx.Provider>;
}

export function useTenantContext() {
  const ctx = useContext(TenantCtx);
  if (!ctx) throw new Error("useTenantContext must be inside TenantContextProvider");
  return ctx;
}
