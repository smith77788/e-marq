/**
 * Smart Data Analysis — статистичний аналіз даних.
 *
 * Методи:
 * 1. Descriptive Statistics — описова статистика
 * 2. Trend Analysis — аналіз трендів
 * 3. Correlation Analysis — аналіз кореляцій
 * 4. Forecasting — прогнозування
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type StatisticalSummary = {
  metric: string;
  mean: number;
  median: number;
  min: number;
  max: number;
  std_dev: number;
  count: number;
};

/**
 * Обчислити описову статистику.
 */
export function calculateStatistics(values: number[]): StatisticalSummary {
  if (values.length === 0) {
    return { metric: "", mean: 0, median: 0, min: 0, max: 0, std_dev: 0, count: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return { metric: "", mean, median, min, max, std_dev: stdDev, count: values.length };
}

/**
 * Аналіз тренду.
 */
export function analyzeTrend(values: number[]): { direction: "up" | "down" | "stable"; slope: number; r_squared: number } {
  if (values.length < 2) return { direction: "stable", slope: 0, r_squared: 0 };

  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, v) => s + v, 0) / n;

  let xySum = 0;
  let xSqSum = 0;
  for (let i = 0; i < n; i++) {
    xySum += (i - xMean) * (values[i] - yMean);
    xSqSum += Math.pow(i - xMean, 2);
  }

  const slope = xSqSum > 0 ? xySum / xSqSum : 0;
  const ssRes = values.reduce((s, v, i) => s + Math.pow(v - (yMean + slope * (i - xMean)), 2), 0);
  const ssTot = values.reduce((s, v) => s + Math.pow(v - yMean, 2), 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return {
    direction: slope > 0.1 ? "up" : slope < -0.1 ? "down" : "stable",
    slope,
    r_squared: rSquared,
  };
}
