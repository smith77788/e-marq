/**
 * Гейт за активною підпискою. Повертає:
 *  - loading — поки запит у процесі
 *  - hasAccess — true якщо у tenant є підписка зі статусом active/trial
 *  - status — поточний статус підписки (або null коли запису немає)
 *  - planKey — ключ обраного плану (або null)
 *
 * Використовуємо для розділів /agents/* — без оплати тарифу їх не показуємо.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const ACTIVE_STATUSES = new Set(["active", "trial"]);

export type SubscriptionGate = {
  loading: boolean;
  hasAccess: boolean;
  status: string | null;
  planKey: string | null;
};

export function useSubscriptionGate(tenantId: string | null | undefined): SubscriptionGate {
  const q = useQuery({
    queryKey: ["subscription-gate", tenantId],
    enabled: !!tenantId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_subscriptions")
        .select("status, plans:plan_id(key)")
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { status: null as string | null, planKey: null as string | null };
      const planKey = (data.plans as { key?: string } | null)?.key ?? null;
      return { status: data.status as string, planKey };
    },
  });

  const status = q.data?.status ?? null;
  const planKey = q.data?.planKey ?? null;
  return {
    loading: !!tenantId && q.isLoading,
    hasAccess: !!status && ACTIVE_STATUSES.has(status),
    status,
    planKey,
  };
}
