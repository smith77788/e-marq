/**
 * Утиліти для експорту health-логів DN Trade у CSV.
 * Використовується в адмін-дашборді (загальному та drill-down).
 */
export type HealthLogRow = {
  id: string;
  tenant_id: string;
  integration_id: string | null;
  status: string;
  http_status: number;
  ready: boolean;
  blockers: string[] | null;
  warnings: string[] | null;
  last_sync_status: string | null;
  last_sync_age_seconds: number | null;
  checked_at: string;
};

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildHealthCsv(rows: HealthLogRow[]): string {
  const header = [
    "checked_at",
    "tenant_id",
    "integration_id",
    "status",
    "http_status",
    "ready",
    "last_sync_status",
    "last_sync_age_hours",
    "blockers",
    "warnings",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.checked_at,
        r.tenant_id,
        r.integration_id ?? "",
        r.status,
        r.http_status,
        r.ready ? "true" : "false",
        r.last_sync_status ?? "",
        r.last_sync_age_seconds == null ? "" : (r.last_sync_age_seconds / 3600).toFixed(2),
        (r.blockers ?? []).join(" | "),
        (r.warnings ?? []).join(" | "),
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function downloadHealthCsv(rows: HealthLogRow[], filename: string): void {
  if (typeof window === "undefined") return;
  const csv = buildHealthCsv(rows);
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
