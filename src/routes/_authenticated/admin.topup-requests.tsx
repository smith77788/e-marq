/**
 * Адмін-сторінка обробки заявок на поповнення (`topup_requests`).
 *
 * Супер-адмін бачить усі заявки, фільтрує за статусом, додає коментар
 * для бренду і одним кліком підтверджує оплату — RPC `admin_mark_topup_paid`
 * атомарно нараховує AI-кредити власнику бренду.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  Clock,
  Filter,
  Inbox,
  Loader2,
  Phone,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/admin/topup-requests")({
  component: TopupRequestsAdminPage,
});

type Status = "new" | "in_review" | "paid" | "cancelled";
type Row = {
  id: string;
  tenant_id: string;
  credits: number;
  amount_cents: number;
  currency: string;
  payment_method: string;
  contact: string | null;
  note: string | null;
  status: Status;
  manager_note: string | null;
  created_at: string;
  processed_at: string | null;
  tenant?: { name: string | null; slug: string | null } | null;
};

const STATUSES: { id: Status | "all"; label: string; tone: string }[] = [
  { id: "all", label: "Усі", tone: "border-border text-muted-foreground" },
  { id: "new", label: "Нові", tone: "border-info/40 text-info" },
  { id: "in_review", label: "У роботі", tone: "border-warning/40 text-warning" },
  { id: "paid", label: "Оплачено", tone: "border-success/40 text-success" },
  { id: "cancelled", label: "Скасовано", tone: "border-destructive/40 text-destructive" },
];

const STATUS_META: Record<Status, { label: string; tone: string; Icon: typeof Clock }> = {
  new: { label: "Нова", tone: "border-info/40 text-info", Icon: Clock },
  in_review: { label: "У роботі", tone: "border-warning/40 text-warning", Icon: Phone },
  paid: { label: "Оплачено", tone: "border-success/40 text-success", Icon: CheckCircle2 },
  cancelled: { label: "Скасовано", tone: "border-destructive/40 text-destructive", Icon: XCircle },
};

function TopupRequestsAdminPage() {
  const { isSuperAdmin, loading } = useAuth();
  if (loading) return <Skeleton className="h-48" />;
  if (!isSuperAdmin) return <Navigate to="/brand" />;
  return <Content />;
}

function Content() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Status | "all">("new");
  const [search, setSearch] = useState("");

  const list = useQuery({
    queryKey: ["admin-topup-requests", filter],
    queryFn: async () => {
      let q = supabase
        .from("topup_requests")
        .select(
          "id, tenant_id, credits, amount_cents, currency, payment_method, contact, note, status, manager_note, created_at, processed_at, tenant:tenants(name, slug)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (filter !== "all") q = q.eq("status", filter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const filtered = useMemo(() => {
    const rows = list.data ?? [];
    if (!search.trim()) return rows;
    const s = search.trim().toLowerCase();
    return rows.filter((r) =>
      [r.tenant?.name, r.tenant?.slug, r.contact, r.note, r.id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [list.data, search]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
            <Inbox className="h-5 w-5 text-primary-foreground" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Заявки на поповнення
            </h1>
            <p className="text-sm text-muted-foreground">
              Підтвердьте отриману оплату — кредити нарахуються бренду автоматично.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ["admin-topup-requests"] })}
          disabled={list.isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${list.isFetching ? "animate-spin" : ""}`} />
          Оновити
        </Button>
      </header>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {STATUSES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setFilter(s.id)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  filter === s.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : `${s.tone} bg-card hover:bg-muted/50`
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <Input
            placeholder="Пошук за брендом, контактом, ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
        </CardHeader>
        <CardContent className="p-0">
          {list.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Заявок не знайдено.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((r) => (
                <RequestRow key={r.id} row={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RequestRow({ row }: { row: Row }) {
  const meta = STATUS_META[row.status];
  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={meta.tone}>
            <meta.Icon className="mr-1 h-3 w-3" />
            {meta.label}
          </Badge>
          <Badge variant="secondary" className="font-mono text-[10px]">
            /{row.tenant?.slug ?? "—"}
          </Badge>
          <p className="text-sm font-semibold text-foreground">
            {row.tenant?.name ?? "Бренд"}
          </p>
          <span className="text-xs text-muted-foreground">
            · {new Date(row.created_at).toLocaleString("uk-UA")}
          </span>
        </div>
        <p className="text-sm text-foreground">
          <span className="font-mono font-semibold">
            {row.credits.toLocaleString("uk-UA")}
          </span>{" "}
          AI-кредитів · {(row.amount_cents / 100).toFixed(0)} {row.currency} ·{" "}
          <span className="text-muted-foreground">{row.payment_method}</span>
        </p>
        {row.contact && (
          <p className="text-xs text-muted-foreground">
            📞 {row.contact}
            {row.note ? ` · 💬 ${row.note}` : ""}
          </p>
        )}
        {row.manager_note && (
          <p className="text-xs italic text-muted-foreground">
            Менеджер: {row.manager_note}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {row.status !== "paid" && row.status !== "cancelled" && (
          <ProcessDialog row={row} />
        )}
      </div>
    </div>
  );
}

function ProcessDialog({ row }: { row: Row }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string>(row.manager_note ?? "");


  const updateStatus = useMutation({
    mutationFn: async (next: Status) => {
      if (next === "paid") {
        const { error } = await supabase.rpc("admin_mark_topup_paid", {
          _request_id: row.id,
          _manager_note: note.trim() || undefined,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from("topup_requests")
        .update({
          status: next,
          manager_note: note.trim() || null,
          processed_at: next === "cancelled" ? new Date().toISOString() : null,
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: (_, next) => {
      toast.success(
        next === "paid"
          ? `Зараховано ${row.credits.toLocaleString("uk-UA")} кредитів`
          : "Заявку оновлено",
      );
      qc.invalidateQueries({ queryKey: ["admin-topup-requests"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Send className="mr-1.5 h-3.5 w-3.5" />
        Обробити
      </Button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Заявка #{row.id.slice(0, 8)}</DialogTitle>
          <DialogDescription>
            {row.tenant?.name} · {row.credits.toLocaleString("uk-UA")} кредитів ·{" "}
            {(row.amount_cents / 100).toFixed(0)} {row.currency}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="manager-note">Коментар для бренду</Label>
            <Textarea
              id="manager-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Напр., рахунок надіслано на e-mail, очікуємо оплату до пʼятниці"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={updateStatus.isPending}
            onClick={() => updateStatus.mutate("in_review")}
          >
            <Phone className="mr-1.5 h-4 w-4" />
            Взяв у роботу
          </Button>
          <Button
            variant="outline"
            disabled={updateStatus.isPending}
            onClick={() => updateStatus.mutate("cancelled")}
          >
            <XCircle className="mr-1.5 h-4 w-4" />
            Скасувати
          </Button>
          <Button
            disabled={updateStatus.isPending}
            onClick={() => updateStatus.mutate("paid")}
          >
            {updateStatus.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
            )}
            Оплачено · нарахувати кредити
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
