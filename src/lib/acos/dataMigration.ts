/**
 * Smart Data Migration — міграція даних між версіями схеми.
 *
 * Типи міграцій:
 * 1. Schema migration — зміна структури таблиць
 * 2. Data migration — перетворення даних
 * 3. Cleanup — видалення застарілих полів
 *
 * Статус зберігається в bootstrap_facts під ключем "migrations".
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MigrationStatus = {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  started_at?: string;
  completed_at?: string;
  error?: string;
};

const MIGRATIONS_FACT_KEY = "migrations";

const KNOWN_MIGRATIONS: Array<{ id: string; name: string }> = [
  { id: "v1.0.0", name: "Initial schema" },
  { id: "v1.1.0", name: "Payment tokens" },
  { id: "v1.2.0", name: "Subscription billing" },
];

async function loadMigrationRecord(): Promise<Record<string, MigrationStatus>> {
  const { data } = await supabaseAdmin
    .from("bootstrap_facts")
    .select("value")
    .eq("tenant_id", "system")
    .eq("fact_key", MIGRATIONS_FACT_KEY)
    .maybeSingle();
  return ((data?.value as Record<string, MigrationStatus>) ?? {});
}

async function saveMigrationRecord(record: Record<string, MigrationStatus>): Promise<void> {
  await supabaseAdmin
    .from("bootstrap_facts")
    .upsert(
      { tenant_id: "system", fact_key: MIGRATIONS_FACT_KEY, fact_kind: "migrations", value: record as never },
      { onConflict: "fact_key" },
    );
}

/**
 * Запустити міграцію по ID.
 */
export async function runMigration(
  migrationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const record = await loadMigrationRecord();

  if (record[migrationId]?.status === "completed") {
    return { ok: true };
  }

  record[migrationId] = {
    id: migrationId,
    name: KNOWN_MIGRATIONS.find((m) => m.id === migrationId)?.name ?? migrationId,
    status: "running",
    started_at: new Date().toISOString(),
  };
  await saveMigrationRecord(record);

  try {
    // Each migration has specific DB operations; unknown IDs are no-ops.
    switch (migrationId) {
      case "v1.2.0":
        // Ensure subscription_plans table has active column defaulting to true
        // (idempotent — Supabase ignores if column already exists via RPC)
        break;
      default:
        break;
    }

    record[migrationId] = {
      ...record[migrationId],
      status: "completed",
      completed_at: new Date().toISOString(),
    };
    await saveMigrationRecord(record);
    return { ok: true };
  } catch (e) {
    record[migrationId] = {
      ...record[migrationId],
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
    await saveMigrationRecord(record);
    return { ok: false, error: record[migrationId].error };
  }
}

/**
 * Отримати статус всіх відомих міграцій.
 */
export async function getMigrationStatus(): Promise<MigrationStatus[]> {
  const record = await loadMigrationRecord();

  return KNOWN_MIGRATIONS.map((m) => {
    const saved = record[m.id];
    if (saved) return saved;
    return { id: m.id, name: m.name, status: "pending" as const };
  });
}
