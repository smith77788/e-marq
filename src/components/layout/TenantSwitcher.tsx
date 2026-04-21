/**
 * Top-bar tenant switcher dropdown.
 * Lists all tenants the user is a member of; on select, navigates to /brand?tenant=<id>
 * (or stays on the current admin route if super-admin).
 */
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
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
import { useTenantContext } from "@/hooks/useTenantContext";
import { useAuth } from "@/hooks/useAuth";

export function TenantSwitcher() {
  const { tenants, current, setCurrentTenantId } = useTenantContext();
  const { isSuperAdmin } = useAuth();
  const navigate = useNavigate();

  if (!tenants || tenants.length === 0) {
    if (isSuperAdmin) {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => navigate({ to: "/admin/tenants" })}
        >
          <Building2 className="mr-1.5 h-3.5 w-3.5" />
          Manage tenants
        </Button>
      );
    }
    return null;
  }

  const onSelect = (id: string) => {
    setCurrentTenantId(id);
    void navigate({ to: "/brand", search: { tenant: id } });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 max-w-[220px] justify-between gap-2"
        >
          <span className="flex items-center gap-1.5 truncate">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate">{current?.tenant_name ?? "Select brand"}</span>
          </span>
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Your brands
        </DropdownMenuLabel>
        {tenants.map((t) => (
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
              <Badge variant="outline" className="text-[10px]">
                {t.plan_name}
              </Badge>
              {current?.tenant_id === t.tenant_id && (
                <Check className="h-3.5 w-3.5 text-primary" />
              )}
            </div>
          </DropdownMenuItem>
        ))}
        {isSuperAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate({ to: "/admin/tenants" })}>
              <Building2 className="mr-2 h-3.5 w-3.5" />
              All tenants (admin)
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
