/**
 * Super-admin card listing brands awaiting verification.
 * Allows the admin to approve (status -> active) or reject (status -> suspended
 * + rejection_reason) a brand created self-service by a tenant owner.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Clock, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

type PendingTenant = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  owner_user_id: string;
  owner_email: string | null;
  verification_requested_at: string | null;
  created_at: string;
};

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "щойно";
  if (m < 60) return `${m} хв тому`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} год тому`;
  const d = Math.floor(h / 24);
  return `${d} дн тому`;
}

export function PendingTenantsCard() {
  const qc = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<PendingTenant | null>(null);
  const [reason, setReason] = useState("");

  const query = useQuery({
    queryKey: ["pending-tenants"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_pending_tenants");
      if (error) throw error;
      return (data ?? []) as PendingTenant[];
    },
  });

  const approve = useMutation({
    mutationFn: async (tenantId: string) => {
      const { error } = await supabase.rpc("admin_verify_tenant", { _tenant_id: tenantId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Бренд підтверджено ✓");
      void qc.invalidateQueries({ queryKey: ["pending-tenants"] });
      void qc.invalidateQueries({ queryKey: ["all-tenants-overview"] });
      void qc.invalidateQueries({ queryKey: ["my-tenants"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async ({ tenantId, reason }: { tenantId: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_reject_tenant", {
        _tenant_id: tenantId,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Заявку відхилено");
      setRejectTarget(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["pending-tenants"] });
      void qc.invalidateQueries({ queryKey: ["all-tenants-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = query.data ?? [];

  return (
    <>
      <Card
        className={
          items.length > 0
            ? "border-warning/50 bg-warning/5"
            : "border-dashed"
        }
      >
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert
                  className={`h-4 w-4 ${items.length > 0 ? "text-warning" : "text-muted-foreground"}`}
                />
                Заявки на верифікацію
                {items.length > 0 && (
                  <Badge className="bg-warning/20 text-warning border-warning/40 hover:bg-warning/30">
                    {items.length}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Користувачі створили бренд і чекають вашого підтвердження.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">Завантаження…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Активних заявок немає. Усе підтверджено ✓
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((t) => (
                <div
                  key={t.tenant_id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t.tenant_name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        /{t.tenant_slug}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        Власник:{" "}
                        <span className="font-mono">{t.owner_email ?? t.owner_user_id.slice(0, 8)}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatRelative(t.verification_requested_at ?? t.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRejectTarget(t)}
                      disabled={approve.isPending}
                    >
                      <X className="mr-1 h-3.5 w-3.5" />
                      Відхилити
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => approve.mutate(t.tenant_id)}
                      disabled={approve.isPending}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" />
                      Підтвердити
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!rejectTarget}
        onOpenChange={(v) => {
          if (!v) {
            setRejectTarget(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Відхилити заявку</DialogTitle>
            <DialogDescription>
              Бренд <strong>{rejectTarget?.tenant_name}</strong> буде позначено як призупинений.
              Власник побачить причину відмови.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reason">Причина відмови</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Наприклад: підозра на спам, недостатньо інформації…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Скасувати
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                rejectTarget && reject.mutate({ tenantId: rejectTarget.tenant_id, reason })
              }
              disabled={reject.isPending}
            >
              <X className="mr-1 h-4 w-4" />
              Відхилити заявку
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
