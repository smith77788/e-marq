/**
 * DomainsManager — UI для керування власними доменами тенанта.
 * Підтримує додавання, видалення, перевірку DNS-токена і встановлення
 * основного домену. Спирається на public.tenant_domains (RLS).
 */
import { useState } from "react";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  Copy,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/ui/empty-state";
import { supabase } from "@/integrations/supabase/client";

type DomainRow = {
  id: string;
  tenant_id: string;
  domain: string;
  status: string;
  is_primary: boolean;
  verification_token: string;
  verified_at: string | null;
  last_checked_at: string | null;
  notes: string | null;
  created_at: string;
};

const statusBadge = (status: string) => {
  switch (status) {
    case "active":
    case "verified":
      return <Badge className="bg-success/15 text-success border-success/30">Verified</Badge>;
    case "verifying":
      return (
        <Badge variant="outline" className="border-info/40 text-info">
          Verifying…
        </Badge>
      );
    case "pending":
      return <Badge variant="outline">Pending DNS</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
};

export function DomainsManager({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [newDomain, setNewDomain] = useState("");
  const [deletingDomain, setDeletingDomain] = useState<{ id: string; domain: string } | null>(null);

  const list = useQuery({
    queryKey: ["tenant-domains", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_domains")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DomainRow[];
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      const d = newDomain
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "");
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new Error("Невалідний домен");
      const { error } = await supabase
        .from("tenant_domains")
        .insert({ tenant_id: tenantId, domain: d, status: "pending", is_primary: false });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Домен додано. Налаштуйте DNS, тоді натисніть «Перевірити».");
      setNewDomain("");
      qc.invalidateQueries({ queryKey: ["tenant-domains", tenantId] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Не вдалося додати домен"),
  });

  const verifyMut = useMutation({
    mutationFn: async (id: string) => {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Авторизуйтеся");
      const r = await fetch("/api/domains/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ domainId: id }),
      });
      const json = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        verified?: boolean;
        issues?: string[];
        error?: string;
      };
      if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
      return json;
    },
    onSuccess: (data) => {
      if (data.verified) {
        toast.success("Домен підтверджено ✓");
      } else {
        toast.error(
          data.issues && data.issues.length > 0
            ? data.issues.join(" · ")
            : "Перевірка не пройшла. Перевірте DNS і спробуйте ще раз.",
        );
      }
      qc.invalidateQueries({ queryKey: ["tenant-domains", tenantId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Не вдалося перевірити"),
  });

  const setPrimaryMut = useMutation({
    mutationFn: async (id: string) => {
      // Спочатку встановлюємо цільовий домен як primary — якщо впаде, старий primary лишається.
      // Потім знімаємо прапор з усіх ІНШИХ — якщо впаде, матимемо дублікат (менш критично).
      const { error: e1 } = await supabase
        .from("tenant_domains")
        .update({ is_primary: true })
        .eq("id", id);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("tenant_domains")
        .update({ is_primary: false })
        .eq("tenant_id", tenantId)
        .neq("id", id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Основний домен оновлено");
      qc.invalidateQueries({ queryKey: ["tenant-domains", tenantId] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Не вдалося змінити основний домен"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tenant_domains").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Домен видалено");
      qc.invalidateQueries({ queryKey: ["tenant-domains", tenantId] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Не вдалося видалити домен"),
  });

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} скопійовано`),
      () => toast.error("Не вдалося скопіювати — скопіюйте вручну"),
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" /> Власний домен магазину
          </CardTitle>
          <CardDescription>
            Підключіть свій домен (наприклад, <span className="font-mono">shop.brand.com</span>),
            щоб вітрина відкривалась за вашою адресою. Реєстрація домену відбувається у вашого
            реєстратора.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="new-domain">Додати домен</Label>
            <div className="flex gap-2">
              <Input
                id="new-domain"
                placeholder="shop.example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                disabled={addMut.isPending}
              />
              <Button
                onClick={() => addMut.mutate()}
                disabled={addMut.isPending || !newDomain.trim()}
              >
                {addMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-1.5 h-4 w-4" /> Додати
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Без <span className="font-mono">https://</span> та слешів. Можна піддомен.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Як підключити (DNS)</p>
            <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
              <li>
                У реєстратора додайте <span className="font-mono">CNAME</span>:{" "}
                <span className="font-mono">your-domain → e-marq.lovable.app</span>
              </li>
              <li>
                Додайте <span className="font-mono">TXT</span>{" "}
                <span className="font-mono">_marq-verify</span> = ваш токен (нижче)
              </li>
              <li>Зачекайте 5–60 хв і натисніть «Перевірити»</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Підключені домени</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Завантажую…</p>
          ) : (list.data ?? []).length === 0 ? (
            <EmptyState
              variant="inline"
              icon={Globe}
              title="Поки що жодного власного домену"
              description="Додайте перший домен у формі вище — і ми згенеруємо DNS-токен для верифікації."
            />
          ) : (
            (list.data ?? []).map((d) => (
              <div key={d.id} className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-foreground">
                      {d.domain}
                    </span>
                    {statusBadge(d.status)}
                    {d.is_primary && (
                      <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                        <Star className="h-3 w-3 fill-primary" /> Основний
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => verifyMut.mutate(d.id)}
                      disabled={verifyMut.isPending}
                    >
                      <RefreshCw className="mr-1 h-3.5 w-3.5" /> Перевірити
                    </Button>
                    {!d.is_primary && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPrimaryMut.mutate(d.id)}
                        disabled={setPrimaryMut.isPending}
                      >
                        <Star className="mr-1 h-3.5 w-3.5" /> Зробити основним
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeletingDomain({ id: d.id, domain: d.domain })}
                      disabled={deleteMut.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      TXT-токен (DNS verification)
                    </p>
                    <div className="flex items-center gap-1">
                      <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-[11px] font-mono text-foreground">
                        {d.verification_token}
                      </code>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => copy(d.verification_token, "Токен")}
                        aria-label="Копіювати TXT-токен"
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Статус DNS
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {d.verified_at ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Підтверджено{" "}
                          {new Date(d.verified_at).toLocaleDateString("uk-UA")}
                        </>
                      ) : d.status === "failed" ? (
                        <>
                          <XCircle className="h-3.5 w-3.5 text-destructive" /> Помилка перевірки
                        </>
                      ) : d.last_checked_at ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Перевіряємо…
                        </>
                      ) : (
                        <>
                          <XCircle className="h-3.5 w-3.5 text-warning" /> Очікує налаштування DNS
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {d.notes && d.status !== "active" && (
                  <p className="rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                    {d.notes}
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={deletingDomain !== null}
        onOpenChange={(open) => !open && setDeletingDomain(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Видалити домен?</AlertDialogTitle>
            <AlertDialogDescription>
              Домен <strong>{deletingDomain?.domain}</strong> буде видалено. Сайт перестане
              відкриватись за цією адресою.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Скасувати</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const d = deletingDomain;
                setDeletingDomain(null);
                if (d) deleteMut.mutate(d.id);
              }}
            >
              Видалити
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
