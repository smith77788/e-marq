/**
 * Shared ingest-logs viewer used by both /admin/ingest-logs (super-admin, all
 * tenants) and /brand/ingest-logs (owner, scoped by RLS to their tenants).
 *
 * Hybrid feed:
 *   - Errors come from `ingest_error_logs` (4xx/5xx + body + IP/UA/origin).
 *   - Successes come from `events` table within the selected time window.
 *
 * RLS does the access control:
 *   - super_admin → sees everything
 *   - tenant member → sees only their tenant's rows
 * No extra server-side check is needed in this component.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, AlertCircle, CheckCircle2, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

type ErrorRow = {
  id: string;
  tenant_id: string | null;
  tenant_slug_attempted: string | null;
  status_code: number;
  error_code: string;
  error_message: string | null;
  request_body: unknown;
  request_ip: string | null;
  user_agent: string | null;
  origin: string | null;
  event_type_attempted: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  tenant_id: string;
  type: string;
  session_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type FeedRow = {
  kind: "error" | "success";
  id: string;
  created_at: string;
  status_code: number;
  tenant_id: string | null;
  tenant_slug: string | null;
  event_type: string | null;
  error_code: string | null;
  message: string | null;
  raw: ErrorRow | EventRow;
};

const RANGES: Record<string, number> = {
  "1h": 1,
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

type Props = {
  /** When set, both queries are filtered to this tenant id. */
  tenantId?: string;
  title: string;
};

export function IngestLogsView({ tenantId, title }: Props) {
  const [range, setRange] = useState<keyof typeof RANGES>("24h");
  const [filter, setFilter] = useState<"all" | "errors" | "success">("all");
  const [selected, setSelected] = useState<FeedRow | null>(null);

  const sinceIso = useMemo(() => {
    const d = new Date(Date.now() - RANGES[range] * 3600 * 1000);
    return d.toISOString();
  }, [range]);

  // tenants slug map for nicer rendering
  const { data: tenantSlugs } = useQuery({
    queryKey: ["tenants-slugs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("id, slug").limit(2000);
      if (error) throw error;
      return new Map((data ?? []).map((t) => [t.id, t.slug as string]));
    },
  });

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["ingest-logs", tenantId ?? "all", sinceIso, filter],
    queryFn: async (): Promise<FeedRow[]> => {
      const rows: FeedRow[] = [];

      if (filter !== "success") {
        let q = supabase
          .from("ingest_error_logs")
          .select("*")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(300);
        if (tenantId) q = q.eq("tenant_id", tenantId);
        const { data: errs, error: errErr } = await q;
        if (errErr) throw errErr;
        for (const e of (errs ?? []) as ErrorRow[]) {
          rows.push({
            kind: "error",
            id: `e-${e.id}`,
            created_at: e.created_at,
            status_code: e.status_code,
            tenant_id: e.tenant_id,
            tenant_slug:
              e.tenant_slug_attempted ??
              (e.tenant_id ? (tenantSlugs?.get(e.tenant_id) ?? null) : null),
            event_type: e.event_type_attempted,
            error_code: e.error_code,
            message: e.error_message,
            raw: e,
          });
        }
      }

      if (filter !== "errors") {
        let q = supabase
          .from("events")
          .select("id, tenant_id, type, session_id, payload, created_at")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(300);
        if (tenantId) q = q.eq("tenant_id", tenantId);
        const { data: evs, error: evErr } = await q;
        if (evErr) throw evErr;
        for (const ev of (evs ?? []) as unknown as EventRow[]) {
          rows.push({
            kind: "success",
            id: `s-${ev.id}`,
            created_at: ev.created_at,
            status_code: 200,
            tenant_id: ev.tenant_id,
            tenant_slug: tenantSlugs?.get(ev.tenant_id) ?? null,
            event_type: ev.type,
            error_code: null,
            message: ev.session_id ? `session: ${ev.session_id}` : null,
            raw: ev,
          });
        }
      }

      rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return rows.slice(0, 500);
    },
    refetchInterval: 30_000,
  });

  const counts = useMemo(() => {
    const c = { total: 0, errors: 0, success: 0 };
    for (const r of data ?? []) {
      c.total++;
      if (r.kind === "error") c.errors++;
      else c.success++;
    }
    return c;
  }, [data]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Усі POST-запити на /hooks/ingest. Auto-refresh кожні 30с.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as keyof typeof RANGES)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">Остання година</SelectItem>
              <SelectItem value="24h">24 години</SelectItem>
              <SelectItem value="7d">7 днів</SelectItem>
              <SelectItem value="30d">30 днів</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Усі</SelectItem>
              <SelectItem value="errors">Тільки помилки</SelectItem>
              <SelectItem value="success">Тільки успіх</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Усього" value={counts.total} />
        <StatCard label="Помилки" value={counts.errors} tone="error" />
        <StatCard label="Успішні" value={counts.success} tone="success" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Останні запити</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {isLoading ? (
            <div className="space-y-2 px-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (data?.length ?? 0) === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              Немає записів за обраний період.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">Час</TableHead>
                    <TableHead className="w-[70px]">Код</TableHead>
                    {!tenantId && <TableHead>Tenant</TableHead>}
                    <TableHead>Тип події</TableHead>
                    <TableHead>Помилка / Сесія</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.map((r) => (
                    <TableRow
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className="cursor-pointer"
                    >
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("uk-UA", {
                          hour12: false,
                        })}
                      </TableCell>
                      <TableCell>
                        <StatusBadge code={r.status_code} />
                      </TableCell>
                      {!tenantId && (
                        <TableCell className="text-xs">
                          {r.tenant_slug ? (
                            <code className="rounded bg-muted px-1.5 py-0.5">
                              {r.tenant_slug}
                            </code>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-xs">
                        {r.event_type ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="max-w-[420px] truncate text-xs">
                        {r.error_code ? (
                          <span className="text-destructive">
                            <code className="font-medium">{r.error_code}</code>
                            {r.message ? ` · ${r.message}` : ""}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{r.message ?? "—"}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>
              {selected?.kind === "error" ? "Помилка ingest" : "Успішна подія"}
            </SheetTitle>
          </SheetHeader>
          {selected && <DetailPanel row={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "error" | "success";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className={`mt-1 text-2xl font-semibold ${
            tone === "error"
              ? "text-destructive"
              : tone === "success"
                ? "text-success"
                : "text-foreground"
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ code }: { code: number }) {
  const variant: "default" | "destructive" | "secondary" =
    code >= 500 ? "destructive" : code >= 400 ? "secondary" : "default";
  const Icon = code >= 400 ? AlertCircle : CheckCircle2;
  return (
    <Badge variant={variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {code}
    </Badge>
  );
}

function DetailPanel({ row }: { row: FeedRow }) {
  const r = row.raw as ErrorRow & EventRow;
  const isError = row.kind === "error";
  return (
    <div className="mt-4 space-y-4 text-sm">
      <KV label="Час" value={new Date(row.created_at).toISOString()} />
      <KV label="Статус" value={String(row.status_code)} />
      <KV label="Slug бренду" value={row.tenant_slug ?? "—"} />
      <KV label="ID бренду" value={row.tenant_id ?? "—"} mono />
      <KV label="Тип події" value={row.event_type ?? "—"} />
      {isError && (
        <>
          <KV label="Код помилки" value={(r as ErrorRow).error_code ?? "—"} mono />
          <KV label="Повідомлення помилки" value={(r as ErrorRow).error_message ?? "—"} />
          <KV label="IP" value={(r as ErrorRow).request_ip ?? "—"} mono />
          <KV label="User-Agent" value={(r as ErrorRow).user_agent ?? "—"} />
          <KV label="Джерело" value={(r as ErrorRow).origin ?? "—"} />
        </>
      )}
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
          {isError ? "Тіло запиту" : "Payload"}
        </div>
        <pre className="max-h-[400px] overflow-auto rounded bg-muted p-3 text-xs">
          {JSON.stringify(
            isError ? (r as ErrorRow).request_body : (r as EventRow).payload,
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={mono ? "break-all font-mono text-xs" : "break-words text-sm"}>{value}</div>
    </div>
  );
}
