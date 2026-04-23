/**
 * Returns the granular admin capabilities for the current user.
 * Super-admins are auto-granted all capabilities.
 * Other users see only capabilities present in admin_permissions for their user_id.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const ADMIN_CAPABILITIES = [
  "read_tenants",
  "manage_users",
  "change_plans",
  "change_status",
  "manage_permissions",
] as const;
export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

export function useAdminCapabilities() {
  const { user, isSuperAdmin, loading } = useAuth();

  const query = useQuery({
    queryKey: ["admin-permissions", user?.id],
    enabled: !!user && !isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_permissions")
        .select("capability")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.capability as AdminCapability);
    },
  });

  const granted = isSuperAdmin
    ? new Set<AdminCapability>(ADMIN_CAPABILITIES)
    : new Set<AdminCapability>(query.data ?? []);

  return {
    loading: loading || (!isSuperAdmin && query.isLoading),
    isSuperAdmin,
    capabilities: granted,
    has: (cap: AdminCapability) => granted.has(cap),
  };
}
