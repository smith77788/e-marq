/**
 * Smart Analytics Dashboard — агрегує всі smart engines в один
 * інтерактивний дашборд для власника бренду.
 *
 * Секції:
 * 1. Revenue Pulse — виручка в реальному часі
 * 2. Revenue Leaks — витоки виручки
 * 3. Customer Health — здоров'я бази клієнтів
 * 4. Agent Performance — продуктивність агентів
 * 5. Quick Actions — швидкі дії одним кліком
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { analyzeRevenueLeaks, type RevenueLeak } from "./revenueRecovery";
import { segmentCustomers, type SegmentStats } from "./customerSegmentation";
import { predictCustomerLtv, type ClvPrediction } from "./clvPredictor";

export type DashboardData = {
  revenue: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    trend: number; // percentage change vs previous period
  };
  leaks: RevenueLeak[];
  segments: SegmentStats;
  topCustomers: ClvPrediction[];
  quickActions: QuickAction[];
  agentStats: {
    totalAgents: number;
    activeAgents: number;
    insightsToday: number;
    actionsApplied: number;
  };
};

export type QuickAction = {
  id: string;
  title: string;
  description: string;
  impact: string;
  action_url: string;
  priority: "high" | "medium" | "low";
};

/**
 * Зібрати повний дашборд для тенанта.
 */
export async function getDashboardData(
  tenantId: string,
): Promise<DashboardData> {
  // Паралельний збір даних
  const [
    revenueData,
    leakData,
    segmentData,
    clvData,
    agentData,
  ] = await Promise.all([
    getRevenueData(tenantId),
    analyzeRevenueLeaks(tenantId),
    segmentCustomers(tenantId),
    predictCustomerLtv(tenantId),
    getAgentStats(tenantId),
  ]);

  // Генерувати швидкі дії
  const quickActions = generateQuickActions(leakData, segmentData);

  return {
    revenue: revenueData,
    leaks: leakData.leaks,
    segments: segmentData,
    topCustomers: clvData.slice(0, 10),
    quickActions,
    agentStats: agentData,
  };
}

async function getRevenueData(tenantId: string) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
  const prevWeekAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000).toISOString();

  const [today, thisWeek, thisMonth, prevWeek] = await Promise.all([
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", todayStart),
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", weekAgo),
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", monthAgo),
    supabaseAdmin.from("orders").select("total_cents").eq("tenant_id", tenantId).eq("status", "paid").gte("created_at", prevWeekAgo).lt("created_at", weekAgo),
  ]);

  const todayTotal = (today.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const weekTotal = (thisWeek.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const monthTotal = (thisMonth.data ?? []).reduce((s, o) => s + o.total_cents, 0);
  const prevWeekTotal = (prevWeek.data ?? []).reduce((s, o) => s + o.total_cents, 0);

  const trend = prevWeekTotal > 0 ? ((weekTotal - prevWeekTotal) / prevWeekTotal) * 100 : 0;

  return {
    today: todayTotal,
    thisWeek: weekTotal,
    thisMonth: monthTotal,
    trend: Math.round(trend),
  };
}

async function getAgentStats(tenantId: string) {
  const today = new Date().toISOString().split("T")[0];

  const [runs, insights, actions] = await Promise.all([
    supabaseAdmin.from("acos_agent_runs").select("id, agent_id").eq("tenant_id", tenantId).gte("started_at", today),
    supabaseAdmin.from("ai_insights").select("id").eq("tenant_id", tenantId).gte("created_at", today),
    supabaseAdmin.from("ai_actions").select("id").eq("tenant_id", tenantId).gte("applied_at", today),
  ]);

  const uniqueAgents = new Set((runs.data ?? []).map((r) => r.agent_id));

  return {
    totalAgents: 58,
    activeAgents: uniqueAgents.size,
    insightsToday: (insights.data ?? []).length,
    actionsApplied: (actions.data ?? []).length,
  };
}

function generateQuickActions(
  leaks: { leaks: RevenueLeak[] },
  segments: SegmentStats,
): QuickAction[] {
  const actions: QuickAction[] = [];

  // Високопріоритетні витоки
  const criticalLeaks = leaks.leaks.filter((l) => l.severity === "critical");
  for (const leak of criticalLeaks.slice(0, 3)) {
    actions.push({
      id: `leak-${leak.channel}`,
      title: leak.action,
      description: leak.description,
      impact: `−${Math.round(leak.estimated_loss_cents / 100)} ₴`,
      action_url: "/brand/insights",
      priority: "high",
    });
  }

  // Клієнти, що збираються піти
  const atRisk = segments.segments.find((s) => s.id === "at_risk");
  if (atRisk && atRisk.count > 0) {
    actions.push({
      id: "winback",
      title: `Запустити winback для ${atRisk.count} клієнтів`,
      description: "Клієнти не купували 30-60 днів",
      impact: `~${Math.round(atRisk.total_revenue_cents * 0.3 / 100)} ₴`,
      action_url: "/brand/insights",
      priority: "high",
    });
  }

  return actions.slice(0, 5);
}
