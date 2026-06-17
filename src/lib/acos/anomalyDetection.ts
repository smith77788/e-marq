/**
 * Smart Anomaly Detection — виявлення аномалій в даних.
 *
 * Методи:
 * 1. Z-Score — стандартне відхилення
 * 2. IQR — міжквартильний діапазон
 * 3. Moving Average — ковзне середнє
 */

/**
 * Виявити аномалії за Z-Score.
 */
export function detectAnomaliesZScore(
  data: number[],
  threshold: number = 2,
): Array<{ index: number; value: number; z_score: number }> {
  const mean = data.reduce((s, v) => s + v, 0) / data.length;
  const variance = data.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / data.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return [];

  return data
    .map((value, index) => ({
      index,
      value,
      z_score: Math.abs((value - mean) / stdDev),
    }))
    .filter((item) => item.z_score > threshold);
}

/**
 * Виявити аномалії за IQR.
 */
export function detectAnomaliesIQR(
  data: number[],
  multiplier: number = 1.5,
): Array<{ index: number; value: number; is_low: boolean; is_high: boolean }> {
  const sorted = [...data].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - multiplier * iqr;
  const upper = q3 + multiplier * iqr;

  return data
    .map((value, index) => ({
      index,
      value,
      is_low: value < lower,
      is_high: value > upper,
    }))
    .filter((item) => item.is_low || item.is_high);
}

/**
 * Виявити аномалії за ковзним середнім.
 */
export function detectAnomaliesMovingAvg(
  data: number[],
  window: number = 7,
  threshold: number = 2,
): Array<{ index: number; value: number; deviation: number }> {
  const anomalies: Array<{ index: number; value: number; deviation: number }> = [];

  for (let i = window; i < data.length; i++) {
    const slice = data.slice(i - window, i);
    const mean = slice.reduce((s, v) => s + v, 0) / window;
    const stdDev = Math.sqrt(slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / window);

    if (stdDev > 0) {
      const deviation = Math.abs((data[i] - mean) / stdDev);
      if (deviation > threshold) {
        anomalies.push({ index: i, value: data[i], deviation });
      }
    }
  }

  return anomalies;
}
