/**
 * Smart Data Correlation — аналіз зв'язків між даними.
 *
 * Методи:
 * 1. Pearson Correlation — кореляція Пірсона
 * 2. Spearman Rank — рангова кореляція
 * 3. Categorical Association — зв'язок між категоріями
 */

/**
 * Кореляція Пірсона.
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  const xMean = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const yMean = y.slice(0, n).reduce((s, v) => s + v, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - xMean;
    const dy = y[i] - yMean;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denominator = Math.sqrt(denomX * denomY);
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Знайти кореляції між метриками.
 */
export function findCorrelations(
  metrics: Record<string, number[]>,
): Array<{ metric1: string; metric2: string; correlation: number; strength: string }> {
  const keys = Object.keys(metrics);
  const correlations: Array<{ metric1: string; metric2: string; correlation: number; strength: string }> = [];

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const r = pearsonCorrelation(metrics[keys[i]], metrics[keys[j]]);
      if (Math.abs(r) > 0.3) {
        correlations.push({
          metric1: keys[i],
          metric2: keys[j],
          correlation: Math.round(r * 100) / 100,
          strength: Math.abs(r) > 0.7 ? "strong" : Math.abs(r) > 0.5 ? "moderate" : "weak",
        });
      }
    }
  }

  return correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}
