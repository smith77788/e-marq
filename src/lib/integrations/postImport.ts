import { getInternalCronToken } from "@/lib/acos/cronAuth";

const DEFAULT_APP_ORIGIN = "https://e-marq.lovable.app";
const POST_IMPORT_AGENTS = ["integration-scout", "data-gap-auditor"] as const;

export type PostImportAgentId = (typeof POST_IMPORT_AGENTS)[number];

function normalizeOrigin(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

export function resolveAppOrigin(requestOrigin?: string): string {
  return (
    normalizeOrigin(process.env.APP_BASE_URL) ??
    normalizeOrigin(process.env.PUBLIC_APP_URL) ??
    normalizeOrigin(process.env.VITE_PUBLIC_APP_URL) ??
    normalizeOrigin(requestOrigin) ??
    DEFAULT_APP_ORIGIN
  );
}

export async function triggerPostImportAgents(options: {
  tenantId: string;
  requestOrigin?: string;
  fetchImpl?: typeof fetch;
  agentIds?: readonly PostImportAgentId[];
}): Promise<void> {
  const token = getInternalCronToken();
  if (!token) return;

  const fetchImpl = options.fetchImpl ?? fetch;
  const origin = resolveAppOrigin(options.requestOrigin);
  const agentIds = options.agentIds ?? POST_IMPORT_AGENTS;

  await Promise.allSettled(
    agentIds.map(async (agentId) => {
      const res = await fetchImpl(`${origin}/hooks/agents/${agentId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tenant_id: options.tenantId }),
      });
      if (!res.ok) {
        throw new Error(`post-import agent ${agentId} failed with ${res.status}`);
      }
    }),
  );
}

export function queuePostImportAgents(options: {
  tenantId: string;
  requestOrigin?: string;
  fetchImpl?: typeof fetch;
  agentIds?: readonly PostImportAgentId[];
}): void {
  void triggerPostImportAgents(options).catch(() => {});
}
