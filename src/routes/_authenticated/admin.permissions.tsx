/**
 * Admin permissions matrix.
 * Lists every admin/super-admin and lets a manager (super-admin or holder of
 * `manage_permissions`) toggle each granular capability per user.
 * Super-admins are read-only here — they always have all capabilities.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";

export const Route = createFileRoute("/_authenticated/admin/permissions")({
  component: AdminPermissionsPage,
});

type AdminUserRow = {
  user_id: string;
  email: string | null;
  is_super_admin: boolean;
  capabilities: string[];
};

type Capability = {
  key: string;
  label: string;
  description: string;
  sort_order: number;
};

function AdminPermissionsPage() {
  const { loading, has } = useAdminCapabilities();
  const qc = useQueryClient();

  const canManage = has("manage_permissions");

  const capsQuery = useQuery({
    queryKey: ["admin-capabilities-catalog"],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_capabilities")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Capability[];
    },
  });

  const adminsQuery = useQuery({
    queryKey: ["admin-users-permissions"],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_admin_users");
      if (error) throw error;
      return (data ?? []) as AdminUserRow[];
    },
  });

  const grant = useMutation({
    mutationFn: async ({ userId, cap }: { userId: string; cap: string }) => {
      const { error } = await supabase.rpc("admin_grant_capability", {
        _target_user: userId,
        _capability: cap,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Право видано");
      void qc.invalidateQueries({ queryKey: ["admin-users-permissions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async ({ userId, cap }: { userId: string; cap: string }) => {
      const { error } = await supabase.rpc("admin_revoke_capability", {
        _target_user: userId,
        _capability: cap,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Право відкликано");
      void qc.invalidateQueries({ queryKey: ["admin-users-permissions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <PageSkeleton blocks={2} />;
  if (!canManage) return <Navigate to="/admin" />;

  const caps = capsQuery.data ?? [];
  const admins = adminsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
          Безпека · ролі
        </p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Права адміністраторів
        </h1>
        <p className="text-sm text-muted-foreground">
          Видавайте лише ті права, які потрібні для роботи. Super-admin завжди має повний доступ.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Матриця прав
          </CardTitle>
          <CardDescription>
            {admins.length} адмінів · {caps.length} прав
          </CardDescription>
        </CardHeader>
        <CardContent>
          {capsQuery.isLoading || adminsQuery.isLoading ? (
            <TableSkeleton rows={4} columns={6} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Адмін</TableHead>
                    {caps.map((c) => (
                      <TableHead key={c.key} className="text-center">
                        <span title={c.description} className="cursor-help">
                          {c.label}
                        </span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {admins.map((u) => (
                    <TableRow key={u.user_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {u.is_super_admin && (
                            <Crown className="h-3.5 w-3.5 text-primary" />
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-medium">
                              {u.email ?? "—"}
                            </div>
                            {u.is_super_admin && (
                              <Badge variant="secondary" className="text-[10px]">
                                super-admin
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      {caps.map((c) => {
                        const enabled =
                          u.is_super_admin || (u.capabilities ?? []).includes(c.key);
                        return (
                          <TableCell key={c.key} className="text-center">
                            <Switch
                              checked={enabled}
                              disabled={u.is_super_admin || grant.isPending || revoke.isPending}
                              onCheckedChange={(next) => {
                                if (next)
                                  grant.mutate({ userId: u.user_id, cap: c.key });
                                else
                                  revoke.mutate({ userId: u.user_id, cap: c.key });
                              }}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  {admins.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={caps.length + 1} className="text-center text-sm text-muted-foreground">
                        Адмінів ще немає.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
