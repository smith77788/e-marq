/**
 * Smart Data Prediction — прогнозування майбутніх значень.
 *
 * Методи:
 * 1. Moving Average — ковзне середнє
 * 2. Exponential Smoothing — експоненційне згладжування
 * 3. Linear Regression — лінійна регресія
 * 4. Seasonal Decomposition — сезонний аналіз
 */

/**
 * Ковзне середнє.
 */
export function movingAverage(data: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = data.slice(start, i + 1);
    result.push(slice.reduce((s, v) => s + v, 0) / slice.length);
  }
  return result;
}

/**
 * Експоненційне згладжування.
 */
export function exponentialSmoothing(data: number[], alpha: number = 0.3): number[] {
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(alpha * data[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

/**
 * Лінійна регресія.
 */
export function linearRegression(data: number[]): { slope: number; intercept: number; predict: (x: number) => number } {
  const n = data.length;
  const xMean = (n - 1) / 2;
  const yMean = data.reduce((s, v) => s + v, 0) / n;

  let xySum = 0;
  let xSqSum = 0;
  for (let i = 0; i < n; i++) {
    xySum += (i - xMean) * (data[i] - yMean);
    xSqSum += Math.pow(i - xMean, 2);
  }

  const slope = xSqSum > 0 ? xySum / xSqSum : 0;
  const intercept = yMean - slope * xMean;

  return {
    slope,
    intercept,
    predict: (x: number) => slope * x + intercept,
  };
}

/**
 * Прогноз на N днів вперед.
 */
export function forecast(data: number[], days: number): number[] {
  const model = linearRegression(data);
  const result: number[] = [];
  for (let i = 0; i < days; i++) {
    result.push(Math.max(0, Math.round(model.predict(data.length + i))));
  }
  return result;
}
