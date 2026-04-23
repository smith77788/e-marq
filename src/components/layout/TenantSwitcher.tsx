/**
 * Top-bar tenant switcher dropdown.
 * Lists all tenants the user is a member of; on select, navigates to /brand
 * (or stays on the current admin route if super-admin) and updates context.
 *
 * For super-admin without memberships we additionally fetch ALL tenants so the
 * admin can hop into any brand without first becoming a member.
 */
import { useMemo } from "react";
import { Building2, Check, ChevronsUpDown, Plus, ShieldCheck } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTenantContext, type MyTenant } from "@/hooks/useTenantContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type AdminTenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

export function TenantSwitcher() {
  const { tenants, current, setCurrentTenantId } = useTenantContext();
  const { isSuperAdmin } = useAuth();
  const navigate = useNavigate();

  // For super-admin: fetch every tenant so they can hop in even without membership.
  const adminTenantsQuery = useQuery({
    queryKey: ["admin-all-tenants"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, status")
        .order("name");
      if (error) throw error;
      return (data ?? []) as AdminTenant[];
    },
  });

  // Merge: own memberships first (with role + plan), then any extra brands
  // visible to admin only (so admin sees full list).
  const merged: Array<MyTenant & { isAdminOnly?: boolean }> = useMemo(() => {
    const owned = tenants ?? [];
    if (!isSuperAdmin) return owned;
    const ownedIds = new Set(owned.map((t) => t.tenant_id));
    const extras: Array<MyTenant & { isAdminOnly?: boolean }> = (adminTenantsQuery.data ?? [])
      .filter((t) => !ownedIds.has(t.id))
      .map((t) => ({
        tenant_id: t.id,
        tenant_name: t.name,
        tenant_slug: t.slug,
        membership_role: "super_admin",
        plan_key: "—",
        plan_name: "—",
        status: t.status,
        isAdminOnly: true,
      }));
    return [...owned, ...extras];
  }, [tenants, adminTenantsQuery.data, isSuperAdmin]);

  if (merged.length === 0) {
    if (isSuperAdmin) {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => void navigate({ to: "/admin/tenants" })}
        >
          <Building2 className="mr-1.5 h-3.5 w-3.5" />
          Створити бренд
        </Button>
      );
    }
    return null;
  }

  const onSelect = (id: string) => {
    setCurrentTenantId(id);
    void navigate({ to: "/brand", search: { tenant: id } });
  };

  const noneSelected = !current;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 max-w-[260px] justify-between gap-2 transition-colors",
            "border-primary/30 hover:border-primary/60 hover:bg-primary/5",
            noneSelected && "border-warning/60 text-warning shadow-glow",
          )}
          aria-label="Перемкнути бренд"
        >
          <span className="flex items-center gap-1.5 truncate">
            <Building2 className="h-3.5 w-3.5 text-primary" />
            <span className="truncate font-medium">{current?.tenant_name ?? "Оберіть бренд"}</span>
            {current?.tenant_slug && (
              <span className="hidden truncate font-mono text-[10px] text-muted-foreground sm:inline">
                /{current.tenant_slug}
              </span>
            )}
          </span>
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Ваші бренди
        </DropdownMenuLabel>
        {merged.map((t) => (
          <DropdownMenuItem
            key={t.tenant_id}
            onClick={() => onSelect(t.tenant_id)}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{t.tenant_name}</span>
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                /{t.tenant_slug} · {t.membership_role}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {t.isAdminOnly ? (
                <Badge
                  variant="outline"
                  className="border-destructive/40 text-destructive text-[10px]"
                >
                  <ShieldCheck className="mr-1 h-2.5 w-2.5" /> admin
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  {t.plan_name}
                </Badge>
              )}
              {current?.tenant_id === t.tenant_id && <Check className="h-3.5 w-3.5 text-primary" />}
            </div>
          </DropdownMenuItem>
        ))}
        {isSuperAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void navigate({ to: "/admin/tenants" })}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              Створити / керувати брендами
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
