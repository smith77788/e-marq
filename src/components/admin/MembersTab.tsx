/**
 * Tenant members + pending invitations management.
 * Tenant admins can add/cancel invites; super-admins can do everything.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Mail, Crown, User } from "lucide-react";
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

export function MembersTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("admin");

  const membersQuery = useQuery({
    queryKey: ["tenant-members", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_memberships")
        .select("user_id, role, created_at")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const invitesQuery = useQuery({
    queryKey: ["tenant-invites", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_invitations")
        .select("id, email, role, status, expires_at, created_at, token")
        .eq("tenant_id", tenantId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invite = useMutation({
    mutationFn: async () => {
      if (!/\S+@\S+\.\S+/.test(email)) throw new Error("Invalid email");
      const { error } = await supabase.from("tenant_invitations").insert({
        tenant_id: tenantId,
        email: email.trim().toLowerCase(),
        role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invitation created");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["tenant-invites", tenantId] });
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
      qc.invalidateQueries({ queryKey: ["tenant-invites", tenantId] });
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
      toast.success("Member removed");
      qc.invalidateQueries({ queryKey: ["tenant-members", tenantId] });
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
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["tenant-members", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(url).then(() => toast.success("Invite link copied"));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invite team member</CardTitle>
          <CardDescription>They'll get a unique link to join this brand.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px] space-y-2">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@example.com" type="email" />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => invite.mutate()} disabled={invite.isPending || !email}>
              <Mail className="mr-1.5 h-4 w-4" />
              Invite
            </Button>
          </div>
        </CardContent>
      </Card>

      {invitesQuery.data && invitesQuery.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {invitesQuery.data.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/20 p-2">
                  <div className="flex flex-col text-sm">
                    <span className="font-medium">{inv.email}</span>
                    <span className="text-[10px] text-muted-foreground">
                      role: {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => copyInviteLink(inv.token)}>Copy link</Button>
                    <Button size="sm" variant="ghost" onClick={() => cancelInvite.mutate(inv.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
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
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          {membersQuery.data && membersQuery.data.length > 0 ? (
            <ul className="space-y-2">
              {membersQuery.data.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-2">
                  <div className="flex items-center gap-2">
                    {m.role === "owner" ? <Crown className="h-4 w-4 text-warning" /> : <User className="h-4 w-4 text-muted-foreground" />}
                    <span className="font-mono text-xs">{m.user_id}</span>
                    <Badge variant="outline">{m.role}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Select value={m.role} onValueChange={(v) => updateRole.mutate({ userId: m.user_id, newRole: v as Role })}>
                      <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="owner">Owner</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="ghost" onClick={() => removeMember.mutate(m.user_id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No members.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
