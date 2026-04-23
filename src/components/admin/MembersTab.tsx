/**
 * Tenant members + pending invitations management.
 * - Displays members by email (not internal IDs).
 * - Uses `create_tenant_invitation` RPC so invitations get a real token
 *   that can be shared as a link.
 * - Super-admins can manage everything; tenant admins can manage their own brand.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Mail, Crown, User, Loader2, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Role = "owner" | "admin" | "member";
type InviteRoleInput = "admin" | "editor" | "viewer";

type MemberRow = {
  user_id: string;
  email: string | null;
  role: string | null;
  joined_at: string;
  last_sign_in_at: string | null;
  is_owner: boolean;
};

type InviteRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  expires_at: string;
  created_at: string;
  invited_by_email: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Власник",
  admin: "Адміністратор",
  editor: "Редактор",
  viewer: "Перегляд",
  member: "Учасник",
};

export function MembersTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRoleInput>("admin");

  const membersQuery = useQuery({
    queryKey: ["tenant-members-v2", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_tenant_members", {
        _tenant_id: tenantId,
      });
      if (error) throw error;
      return (data ?? []) as MemberRow[];
    },
  });

  const invitesQuery = useQuery({
    queryKey: ["tenant-invites-v2", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_tenant_invites", {
        _tenant_id: tenantId,
      });
      if (error) throw error;
      return (data ?? []) as InviteRow[];
    },
  });

  const invite = useMutation({
    mutationFn: async () => {
      if (!/\S+@\S+\.\S+/.test(email)) throw new Error("Невірний email");
      const { error } = await supabase.rpc("create_tenant_invitation", {
        _tenant_id: tenantId,
        _email: email.trim().toLowerCase(),
        _role: role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Запрошення створено · посилання нижче");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["tenant-invites-v2", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("tenant_invitations")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-invites-v2", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("tenant_memberships")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Учасника видалено");
      qc.invalidateQueries({ queryKey: ["tenant-members-v2", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateRole = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: Role }) => {
      const { error } = await supabase
        .from("tenant_memberships")
        .update({ role: newRole })
        .eq("tenant_id", tenantId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Роль оновлено");
      qc.invalidateQueries({ queryKey: ["tenant-members-v2", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Посилання-запрошення скопійовано"));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Запросити людину в команду</CardTitle>
          <CardDescription>
            Вона отримає особисте посилання, щоб приєднатися до бренду.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px] space-y-2">
              <Label>Email</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
                type="email"
              />
            </div>
            <div className="space-y-2">
              <Label>Роль</Label>
              <Select value={role} onValueChange={(v) => setRole(v as InviteRoleInput)}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Перегляд</SelectItem>
                  <SelectItem value="editor">Редактор</SelectItem>
                  <SelectItem value="admin">Адміністратор</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => invite.mutate()} disabled={invite.isPending || !email}>
              {invite.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              {invite.isPending ? "Запрошую…" : "Запросити"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {invitesQuery.data && invitesQuery.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Запрошення, що очікують</CardTitle>
            <CardDescription>
              Скопіюйте посилання та надішліть запрошеному будь-яким каналом.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {invitesQuery.data.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 p-2"
                >
                  <div className="flex flex-col text-sm">
                    <span className="font-medium">{inv.email}</span>
                    <span className="text-[10px] text-muted-foreground">
                      роль: {ROLE_LABEL[inv.role] ?? inv.role}
                      {" · "}діє до {new Date(inv.expires_at).toLocaleDateString("uk-UA")}
                      {inv.invited_by_email ? ` · від ${inv.invited_by_email}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => copyInviteLink(inv.token)}>
                      <Copy className="mr-1 h-3 w-3" />
                      Копіювати посилання
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cancelInvite.mutate(inv.id)}
                      aria-label={`Скасувати запрошення для ${inv.email}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Учасники бренду</CardTitle>
          <CardDescription>
            {membersQuery.data?.length ?? 0} осіб мають доступ до цього бренду.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {membersQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Завантажую…</p>
          ) : membersQuery.data && membersQuery.data.length > 0 ? (
            <ul className="space-y-2">
              {membersQuery.data.map((m) => (
                <li
                  key={m.user_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {m.is_owner ? (
                      <Crown className="h-4 w-4 shrink-0 text-warning" />
                    ) : (
                      <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {m.email ?? <span className="text-muted-foreground">(без email)</span>}
                        </span>
                        <Badge variant={m.is_owner ? "default" : "outline"} className="text-[10px]">
                          {ROLE_LABEL[m.role ?? "member"] ?? m.role}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        приєднався {new Date(m.joined_at).toLocaleDateString("uk-UA")}
                        {m.last_sign_in_at
                          ? ` · останній вхід ${new Date(m.last_sign_in_at).toLocaleDateString("uk-UA")}`
                          : ""}
                      </div>
                    </div>
                  </div>
                  {!m.is_owner && (
                    <div className="flex items-center gap-1">
                      <Select
                        value={m.role ?? "member"}
                        onValueChange={(v) =>
                          updateRole.mutate({ userId: m.user_id, newRole: v as Role })
                        }
                      >
                        <SelectTrigger className="h-7 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Учасник</SelectItem>
                          <SelectItem value="admin">Адміністратор</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeMember.mutate(m.user_id)}
                        aria-label="Видалити учасника"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Поки що немає учасників.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
