/**
 * Pure LTV / churn scoring helpers for the ltv-predictor agent.
 *
 * Extracted so the scoring is continuous, defensible, and unit-tested instead
 * of the previous discrete ladder (0.05 / 0.15 / 0.3 / 0.55 / 0.75 / 0.95) with
 * a hardcoded confidence of 0.8 — which made the agent look like it predicted
 * when it really bucketed.
 */

/**
 * Churn probability (0..1) from how many purchase cycles have elapsed since the
 * customer's last order. Logistic curve centred at 1.5 cycles overdue:
 *   0 cycles → ~0.04, 1 → ~0.25, 1.5 → 0.50, 2 → ~0.75, 3 → ~0.96.
 * Continuous and monotonic, so two customers a day apart never jump a tier.
 */
export function churnProbabilityFromCycles(cyclesSince: number): number {
  const STEEPNESS = 2.2;
  const MIDPOINT = 1.5; // 50% churn when 1.5 cycles overdue
  const x = Number.isFinite(cyclesSince) ? Math.max(0, cyclesSince) : 0;
  const p = 1 / (1 + Math.exp(-STEEPNESS * (x - MIDPOINT)));
  return Math.min(0.97, Math.max(0.02, Number(p.toFixed(3))));
}

/**
 * Confidence (0.3..0.9) in an LTV/churn score, scaled by order history.
 * A single-order customer has an unreliable cycle estimate, so the score must
 * not claim the same confidence as a customer with a long, regular history.
 */
export function ltvConfidence(totalOrders: number): number {
  const n = Number.isFinite(totalOrders) ? Math.max(0, totalOrders) : 0;
  return Math.min(0.9, Math.max(0.3, Number((0.3 + 0.12 * n).toFixed(2))));
}
