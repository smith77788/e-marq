/**
 * Smart Widget System — модульні віджети для дашборду.
 *
 * Типи віджетів:
 * 1. KPI Card — ключова метрика
 * 2. Trend Card — тренд зі стрілкою
 * 3. Progress Bar — прогрес-бар
 * 4. Stat Comparison — порівняння
 * 5. Mini Chart — міні-графік
 */

export type WidgetData = {
  id: string;
  type: "kpi" | "trend" | "progress" | "comparison" | "mini_chart";
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: { direction: "up" | "down" | "stable"; percentage: number };
  progress?: { current: number; target: number; percentage: number };
  comparison?: { current: number; previous: number; change: number };
  chart_data?: number[];
  icon?: string;
  color?: string;
};

/**
 * KPI віджет.
 */
export function createKpiWidget(
  id: string,
  title: string,
  value: string | number,
  options?: { subtitle?: string; icon?: string; color?: string },
): WidgetData {
  return {
    id,
    type: "kpi",
    title,
    value,
    subtitle: options?.subtitle,
    icon: options?.icon,
    color: options?.color,
  };
}

/**
 * Trend віджет.
 */
export function createTrendWidget(
  id: string,
  title: string,
  value: string | number,
  trendDirection: "up" | "down" | "stable",
  trendPercentage: number,
): WidgetData {
  return {
    id,
    type: "trend",
    title,
    value,
    trend: { direction: trendDirection, percentage: trendPercentage },
  };
}

/**
 * Progress віджет.
 */
export function createProgressWidget(
  id: string,
  title: string,
  current: number,
  target: number,
): WidgetData {
  return {
    id,
    type: "progress",
    title,
    value: `${current}/${target}`,
    progress: {
      current,
      target,
      percentage: target > 0 ? Math.round((current / target) * 100) : 0,
    },
  };
}

/**
 * Comparison віджет.
 */
export function createComparisonWidget(
  id: string,
  title: string,
  current: number,
  previous: number,
): WidgetData {
  const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;
  return {
    id,
    type: "comparison",
    title,
    value: current,
    comparison: { current, previous, change: Math.round(change * 10) / 10 },
  };
}
