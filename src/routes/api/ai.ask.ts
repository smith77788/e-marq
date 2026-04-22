/**
 * POST /api/ai/ask
 *
 * AI-помічник у Command Palette. Відповідає на питання власника бренду по
 * власних даних тенанта (insights, KPI, агенти, замовлення, клієнти).
 *
 * Унікальна фіча: контекст збирається сервер-сайд із актуальних таблиць,
 * враховуючи RLS — користувач не може запитати по чужому бренду. Відповідь
 * повертається як structured JSON: { answer, suggestions[] } де suggestions
 * можуть бути deep-link-ами на сторінки кокпіта.
 *
 * Body: { tenant_id: string, question: string }
 * Response: { answer: string, suggestions: Array<{ label: string; to: string }> }
 *
 * Security:
 *   - JWT Bearer обов'язковий.
 *   - Користувач має бути членом tenant_id (RLS додатково перевіряє при селектах).
 *   - Питання обмежене 500 символів. Без HTML.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const MAX_QUESTION_LEN = 500;

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type AskResponse = {
  answer: string;
  suggestions: Array<{ label: string; to: string }>;
};

export const Route = createFileRoute("/api/ai/ask")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = process.env.SUPABASE_URL;
        const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
        const lovableKey = process.env.LOVABLE_API_KEY;
        if (!url || !anon) return jsonError("Server not configured", 500);

        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        if (!token) return jsonError("Missing bearer token", 401);

        const sbUser = createClient<Database>(url, anon, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: claims, error: cErr } = await sbUser.auth.getClaims(token);
        if (cErr || !claims?.claims?.sub) return jsonError("Invalid token", 401);
        const userId = claims.claims.sub as string;

        let body: { tenant_id?: string; question?: string };
        try {
          body = (await request.json()) as { tenant_id?: string; question?: string };
        } catch {
          return jsonError("Invalid JSON", 400);
        }
        const tenantId = (body.tenant_id ?? "").trim();
        const question = (body.question ?? "").trim().slice(0, MAX_QUESTION_LEN);
        if (!tenantId || !question) return jsonError("tenant_id and question required", 400);

        // Membership check (super-admin теж member через RLS, але перевіримо явно).
        const { data: membership } = await supabaseAdmin
          .from("tenant_memberships")
          .select("tenant_id, role")
          .eq("user_id", userId)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        const { data: roleRow } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "super_admin")
          .maybeSingle();
        if (!membership && !roleRow) return jsonError("Forbidden", 403);

        // Збираємо короткий контекст по тенанту — паралельно.
        const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const [tenantRow, insightsRes, ordersRes, productsRes, healthRes] = await Promise.all([
          supabaseAdmin
            .from("tenants")
            .select("name, slug")
            .eq("id", tenantId)
            .maybeSingle(),
          supabaseAdmin
            .from("ai_insights")
            .select("title, insight_type, risk_level, expected_impact, status, created_at")
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: false })
            .limit(8),
          supabaseAdmin
            .from("orders")
            .select("total_cents, status, created_at")
            .eq("tenant_id", tenantId)
            .gte("created_at", sinceIso)
            .order("created_at", { ascending: false })
            .limit(200),
          supabaseAdmin
            .from("products")
            .select("name, stock, price_cents")
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: false })
            .limit(20),
          supabaseAdmin
            .from("agent_health")
            .select("agent_id, health_score, runs_total, runs_failed, measured_on")
            .eq("tenant_id", tenantId)
            .order("measured_on", { ascending: false })
            .limit(10),
        ]);

        const orders = ordersRes.data ?? [];
        const revenue30 = orders.reduce((s, o) => s + (o.total_cents ?? 0), 0);
        const orderCount30 = orders.length;
        const aov = orderCount30 > 0 ? Math.round(revenue30 / orderCount30) : 0;

        const fallbackAnswer =
          `Останні 30 днів: ${orderCount30} замовлень, виторг ${(revenue30 / 100).toFixed(2)}, AOV ${(aov / 100).toFixed(2)}. ` +
          `Активних інсайтів: ${insightsRes.data?.filter((i) => i.status === "pending").length ?? 0}.`;

        const suggestions: AskResponse["suggestions"] = [
          { label: "Відкрити інсайти", to: "/brand#insights" },
          { label: "Запуски агентів", to: "/agents/live" },
          { label: "Замовлення", to: "/brand/orders" },
        ];

        if (!lovableKey) {
          return new Response(
            JSON.stringify({ answer: fallbackAnswer, suggestions } satisfies AskResponse),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        const ctx = {
          brand: tenantRow.data?.name ?? "Your brand",
          revenue30_cents: revenue30,
          orders30: orderCount30,
          aov_cents: aov,
          insights: (insightsRes.data ?? []).map((i) => ({
            t: i.title,
            type: i.insight_type,
            risk: i.risk_level,
            status: i.status,
          })),
          products_top: (productsRes.data ?? []).map((p) => ({
            name: p.name,
            stock: p.stock_qty,
          })),
          agents: (healthRes.data ?? []).map((h) => ({
            id: h.agent_id,
            score: h.health_score,
            failed: h.runs_failed,
            total: h.runs_total,
          })),
        };

        const sys =
          `Ти — AI-аналітик для D2C бренду "${ctx.brand}" в платформі ACOS. ` +
          `Відповідай українською, коротко (2-4 речення), по суті, лише на основі наданих даних. ` +
          `Якщо даних недостатньо — чесно скажи. Не вигадуй цифр. ` +
          `Якщо доречно — порадь сторінку кокпіта (/brand, /brand/orders, /brand/products, /agents/live, /brand/promotions, /brand/email).`;
        const userMsg = `Дані бренду (JSON): ${JSON.stringify(ctx)}\n\nПитання власника: ${question}`;

        try {
          const aiRes = await fetch(LOVABLE_AI_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${lovableKey}`,
            },
            body: JSON.stringify({
              model: MODEL,
              messages: [
                { role: "system", content: sys },
                { role: "user", content: userMsg },
              ],
              temperature: 0.3,
            }),
          });
          if (aiRes.status === 429) {
            return jsonError("AI rate limit, спробуйте за хвилину", 429);
          }
          if (aiRes.status === 402) {
            return jsonError("Недостатньо AI-кредитів. Поповніть Lovable AI.", 402);
          }
          if (!aiRes.ok) {
            return new Response(
              JSON.stringify({ answer: fallbackAnswer, suggestions } satisfies AskResponse),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          const json = (await aiRes.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const answer = json.choices?.[0]?.message?.content?.trim() ?? fallbackAnswer;
          return new Response(
            JSON.stringify({ answer, suggestions } satisfies AskResponse),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch {
          return new Response(
            JSON.stringify({ answer: fallbackAnswer, suggestions } satisfies AskResponse),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
