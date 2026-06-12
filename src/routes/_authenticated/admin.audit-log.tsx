/**
 * /admin/audit-log — Read-only stream of sensitive actions.
 * Super-admin sees all; brand owner/admin sees own tenant rows.
 * Backed by public.audit_log (populated by triggers, no client writes).
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/admin/audit-log")({
  head: () => ({
    meta: [
      { title: "Журнал аудиту — MARQ" },
      { name: "description", content: "Журнал чутливих дій у системі" },
    ],
  }),
  component: AdminAuditLog,
});

type Row = {
  id: number;
  actor_user_id: string | null;
  tenant_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
  created_at: string;
};

const ENTITY_OPTIONS = [
  { value: "all", label: "Усі сутності" },
  { value: "decision_queue", label: "Рішення" },
  { value: "tenant_integrations", label: "Інтеграції" },
  { value: "tenant_memberships", label: "Учасники" },
  { value: "user_roles", label: "Ролі" },
];

function actionBadge(a: string) {
  if (a === "insert") return <Badge variant="secondary">create</Badge>;
  if (a === "update") return <Badge variant="default">update</Badge>;
  if (a === "delete") return <Badge variant="destructive">delete</Badge>;
  return <Badge variant="outline">{a}</Badge>;
}

function AdminAuditLog() {
  const { user, isSuperAdmin, loading } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tenants, setTenants] = useState<Record<string, string>>({});
  const [entity, setEntity] = useState("all");
  const [search, setSearch] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        let q = supabase
          .from("audit_log")
          .select(
            "id, actor_user_id, tenant_id, entity_type, entity_id, action, before, after, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(500);
        if (entity !== "all") q = q.eq("entity_type", entity);
        const sel = await q;
        if (sel.error) throw sel.error;
        const data = (sel.data ?? []) as Row[];
        setRows(data);
        const ids = Array.from(
          new Set(data.map((r) => r.tenant_id).filter((x): x is string => !!x)),
        );
        if (ids.length) {
          const t = await supabase.from("tenants").select("id, name").in("id", ids);
          if (t.data) {
            const map: Record<string, string> = {};
            (t.data as Array<{ id: string; name: string | null }>).forEach((x) => {
              map[x.id] = x.name ?? x.id.slice(0, 8);
            });
            setTenants(map);
          }
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [entity]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.entity_type.toLowerCase().includes(q) ||
        (r.entity_id ?? "").toLowerCase().includes(q) ||
        (r.actor_user_id ?? "").toLowerCase().includes(q) ||
        (r.tenant_id ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!user) return <Navigate to="/login" />;

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-warning" />
        <div>
          <h1 className="text-2xl font-bold">Журнал аудиту</h1>
          <p className="text-sm text-muted-foreground">
            Хто, коли і що змінив у чутливих сутностях. Записи immutable, додаються тригерами БД.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Фільтри</CardTitle>
          <CardDescription>
            {isSuperAdmin ? "Перегляд по всіх тенантах" : "Перегляд обмежений вашим брендом (RLS)"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Пошук по entity_id / actor / tenant"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
        </CardContent>
      </Card>

      {err && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-sm text-destructive">{err}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Останні події ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {!rows ? (
            <Skeleton className="h-64 w-full" />
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Записів поки немає. Тригери активуються при зміні decisions / integrations / ролей.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Коли</TableHead>
                    <TableHead>Дія</TableHead>
                    <TableHead>Сутність</TableHead>
                    <TableHead>Entity ID</TableHead>
                    <TableHead>Бренд</TableHead>
                    <TableHead>Actor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDistanceToNow(new Date(r.created_at), {
                          locale: uk,
                          addSuffix: true,
                        })}
                      </TableCell>
                      <TableCell>{actionBadge(r.action)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.entity_type}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.entity_id ? r.entity_id.slice(0, 8) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.tenant_id ? (tenants[r.tenant_id] ?? r.tenant_id.slice(0, 8)) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.actor_user_id ? r.actor_user_id.slice(0, 8) : "system"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
