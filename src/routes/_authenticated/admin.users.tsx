/**
 * Керування користувачами та ролями (super-admin).
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Search, ShieldCheck, ShieldOff, Users } from "lucide-react";
import { UserTenantsManager } from "@/components/admin/UserTenantsManager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersPage,
});

type UserRow = {
  user_id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  is_super_admin: boolean;
  tenant_count: number;
};

function AdminUsersPage() {
  const { isSuperAdmin, loading, user: currentUser } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<UserRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      return (data ?? []) as UserRow[];
    },
  });

  const grantMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("admin_grant_super_admin", { _target_user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Роль super_admin призначено");
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Не вдалося"),
  });

  const revokeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("admin_revoke_super_admin", { _target_user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Роль super_admin знято");
      setConfirmTarget(null);
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Не вдалося");
      setConfirmTarget(null);
    },
  });

  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!isSuperAdmin) return <Navigate to="/brand" />;

  const users = usersQuery.data ?? [];
  const filtered = search
    ? users.filter((u) => (u.email ?? "").toLowerCase().includes(search.toLowerCase()))
    : users;

  const adminCount = users.filter((u) => u.is_super_admin).length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
          Команда платформи
        </p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Користувачі та ролі</h1>
        <p className="text-sm text-muted-foreground">
          Усі зареєстровані акаунти, призначення ролі super_admin.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Усього користувачів" value={users.length} icon={Users} />
        <StatCard label="Супер-адмінів" value={adminCount} icon={ShieldCheck} accent="primary" />
        <StatCard
          label="З брендами"
          value={users.filter((u) => u.tenant_count > 0).length}
          icon={Users}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Список користувачів</CardTitle>
              <CardDescription>
                {filtered.length} з {users.length}
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
        <CardContent className="overflow-x-auto">
          {usersQuery.isLoading ? (
            <TableSkeleton rows={6} columns={6} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead className="text-right">Брендів</TableHead>
                  <TableHead>Зареєстровано</TableHead>
                  <TableHead>Останній вхід</TableHead>
                  <TableHead className="text-right">Дії</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const isMe = u.user_id === currentUser?.id;
                  const isOpen = expanded === u.user_id;
                  return (
                    <>
                      <TableRow key={u.user_id}>
                        <TableCell className="font-medium">
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : u.user_id)}
                            className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
                            aria-label={isOpen ? "Згорнути" : "Розгорнути"}
                          >
                            {isOpen ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {u.email ?? <span className="text-muted-foreground">(без email)</span>}
                          {isMe && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              це ви
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {u.is_super_admin ? (
                            <Badge className="text-[10px]">super_admin</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              користувач
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {u.tenant_count}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(u.created_at).toLocaleDateString("uk-UA")}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {u.last_sign_in_at
                            ? new Date(u.last_sign_in_at).toLocaleDateString("uk-UA")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {u.is_super_admin ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isMe || revokeMutation.isPending || adminCount <= 1}
                              onClick={() => setConfirmTarget(u)}
                            >
                              <ShieldOff className="mr-1.5 h-3.5 w-3.5" />
                              Зняти роль
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              disabled={grantMutation.isPending}
                              onClick={() => grantMutation.mutate(u.user_id)}
                            >
                              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                              Зробити адміном
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow
                          key={`${u.user_id}-exp`}
                          className="bg-muted/10 hover:bg-muted/10"
                        >
                          <TableCell colSpan={6} className="p-3">
                            <UserTenantsManager userId={u.user_id} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmTarget} onOpenChange={(o) => !o && setConfirmTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Зняти super_admin?</AlertDialogTitle>
            <AlertDialogDescription>
              Користувач <strong>{confirmTarget?.email}</strong> втратить доступ до командного
              центру та керування брендами. Дію можна скасувати, повернувши роль.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Скасувати</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmTarget && revokeMutation.mutate(confirmTarget.user_id)}
            >
              Так, зняти
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  accent?: "primary";
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-4">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent === "primary" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
