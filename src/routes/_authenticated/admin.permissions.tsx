/**
 * Admin permissions matrix.
 * Перелічує УСІХ зареєстрованих користувачів і дозволяє super-admin або
 * утримувачу `manage_permissions` увімкнути/вимкнути будь-яку capability
 * для будь-якого користувача. Super-admin відмічений короною — для нього
 * перемикачі заблоковані, бо він і так має повний доступ.
 *
 * Раніше тут показувалися лише існуючі адміни — тому надати право користувачу,
 * який ще не є адміном, було неможливо. Тепер RPC `admin_list_users_for_permissions`
 * повертає всіх користувачів із пошуком за email.
 */
import { useState } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown, Search, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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

type UserRow = {
  user_id: string;
  email: string | null;
  is_super_admin: boolean;
  capabilities: string[];
  tenant_count: number;
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
  const [search, setSearch] = useState("");

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

  const usersQuery = useQuery({
    queryKey: ["users-for-permissions", search],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users_for_permissions", {
        _search: search || undefined,
      });
      if (error) throw error;
      return (data ?? []) as UserRow[];
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
      void qc.invalidateQueries({ queryKey: ["users-for-permissions"] });
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
      void qc.invalidateQueries({ queryKey: ["users-for-permissions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <PageSkeleton blocks={2} />;
  if (!canManage) return <Navigate to="/admin" />;

  const caps = capsQuery.data ?? [];
  const users = usersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
          Безпека · ролі
        </p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Права адміністраторів</h1>
        <p className="text-sm text-muted-foreground">
          Видавайте лише ті права, які потрібні для роботи. Super-admin завжди має повний доступ.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Матриця прав
              </CardTitle>
              <CardDescription>
                {users.length} користувачів · {caps.length} прав
              </CardDescription>
            </div>
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Пошук за email…"
                className="h-8 pl-7 text-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {capsQuery.isLoading || usersQuery.isLoading ? (
            <TableSkeleton rows={4} columns={6} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Користувач</TableHead>
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
                  {users.map((u) => (
                    <TableRow key={u.user_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {u.is_super_admin && <Crown className="h-3.5 w-3.5 text-primary" />}
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{u.email ?? "—"}</div>
                            <div className="flex items-center gap-1.5">
                              {u.is_super_admin && (
                                <Badge variant="secondary" className="text-[10px]">
                                  super-admin
                                </Badge>
                              )}
                              {u.tenant_count > 0 && (
                                <Badge variant="outline" className="text-[10px]">
                                  {u.tenant_count} брендів
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      {caps.map((c) => {
                        const enabled = u.is_super_admin || (u.capabilities ?? []).includes(c.key);
                        return (
                          <TableCell key={c.key} className="text-center">
                            <Switch
                              checked={enabled}
                              disabled={u.is_super_admin || grant.isPending || revoke.isPending}
                              onCheckedChange={(next) => {
                                if (next) grant.mutate({ userId: u.user_id, cap: c.key });
                                else revoke.mutate({ userId: u.user_id, cap: c.key });
                              }}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  {users.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={caps.length + 1}
                        className="text-center text-sm text-muted-foreground"
                      >
                        {search ? "Користувачів не знайдено." : "Користувачів ще немає."}
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
