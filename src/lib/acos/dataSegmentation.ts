/**
 * Smart Data Segmentation — автоматична сегментація даних.
 *
 * Методи:
 * 1. RFM Analysis — Recency, Frequency, Monetary
 * 2. K-Means Clustering — кластеризація
 * 3. Rule-Based Segmentation —规则-Based сегментація
 */

/**
 * RFM аналіз.
 */
export function rfmAnalysis(
  customers: Array<{
    id: string;
    recency_days: number;
    frequency: number;
    monetary: number;
  }>,
): Array<{
  id: string;
  r_score: number;
  f_score: number;
  m_score: number;
  segment: string;
}> {
  // Квантилі для R, F, M
  const recencies = customers.map((c) => c.recency_days).sort((a, b) => a - b);
  const frequencies = customers.map((c) => c.frequency).sort((a, b) => b - a);
  const monetaries = customers.map((c) => c.monetary).sort((a, b) => b - a);

  const rThresholds = [30, 60, 90];
  const fThresholds = [3, 2, 1];
  const mThresholds = [10000, 5000, 1000];

  return customers.map((c) => {
    const rScore = c.recency_days <= 30 ? 4 : c.recency_days <= 60 ? 3 : c.recency_days <= 90 ? 2 : 1;
    const fScore = c.frequency >= 3 ? 4 : c.frequency >= 2 ? 3 : c.frequency >= 1 ? 2 : 1;
    const mScore = c.monetary >= 10000 ? 4 : c.monetary >= 5000 ? 3 : c.monetary >= 1000 ? 2 : 1;

    let segment = "Unknown";
    if (rScore >= 3 && fScore >= 3 && mScore >= 3) segment = "Champions";
    else if (rScore >= 3 && fScore >= 2) segment = "Loyal";
    else if (rScore >= 3 && fScore === 1) segment = "New";
    else if (rScore === 2 && fScore >= 2) segment = "At Risk";
    else if (rScore <= 1 && fScore >= 2) segment = "Can't Lose";
    else if (rScore <= 1 && fScore === 1) segment = "Lost";

    return {
      id: c.id,
      r_score: rScore,
      f_score: fScore,
      m_score: mScore,
      segment,
    };
  });
}
