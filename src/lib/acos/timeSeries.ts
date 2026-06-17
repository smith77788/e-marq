/**
 * Smart Time Series — аналіз часових рядів.
 *
 * Функції:
 * 1. Декомпозиція (тренд + сезонність + шум)
 * 2. Сезонний аналіз
 * 3. Автокореляція
 * 4. Прогнозування
 */

/**
 * Декомпозиція часового ряду.
 */
export function decomposeTimeSeries(
  data: number[],
  period: number = 7,
): { trend: number[]; seasonal: number[]; residual: number[] } {
  const n = data.length;

  // Тренд (ковзне середнє)
  const trend: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - Math.floor(period / 2));
    const end = Math.min(n, i + Math.floor(period / 2) + 1);
    const slice = data.slice(start, end);
    trend.push(slice.reduce((s, v) => s + v, 0) / slice.length);
  }

  // Сезонність (середнє по періодах)
  const seasonal: number[] = new Array(period).fill(0);
  const counts = new Array(period).fill(0);
  for (let i = 0; i < n; i++) {
    seasonal[i % period] += data[i] - trend[i];
    counts[i % period]++;
  }
  for (let i = 0; i < period; i++) {
    seasonal[i] = counts[i] > 0 ? seasonal[i] / counts[i] : 0;
  }
  // Розгорнути сезонність на весь ряд
  const fullSeasonal = Array.from({ length: n }, (_, i) => seasonal[i % period]);

  // Залишок
  const residual = data.map((v, i) => v - trend[i] - fullSeasonal[i]);

  return { trend, seasonal: fullSeasonal, residual };
}

/**
 * Автокореляція.
 */
export function autocorrelation(data: number[], maxLag: number = 20): number[] {
  const n = data.length;
  const mean = data.reduce((s, v) => s + v, 0) / n;
  const variance = data.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n;

  if (variance === 0) return new Array(maxLag).fill(0);

  return Array.from({ length: maxLag }, (_, lag) => {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += (data[i] - mean) * (data[i + lag] - mean);
    }
    return sum / (n * variance);
  });
}
