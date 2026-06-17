/**
 * Smart Data Clustering — автоматична кластеризація даних.
 *
 * Методи:
 * 1. K-Means — проста кластеризація
 * 2. Hierarchical — ієрархічна кластеризація
 * 3. DBSCAN — кластеризація на основі щільності
 */

/**
 * K-Means кластеризація (спрощена).
 */
export function kMeans(
  data: number[][],
  k: number,
  maxIterations: number = 100,
): { labels: number[]; centroids: number[][] } {
  const n = data.length;
  const d = data[0]?.length ?? 0;

  // Ініціалізація центроїдів (випадкові точки)
  let centroids = data.slice(0, k).map((p) => [...p]);
  let labels = new Array(n).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Призначити точки до найближчого центроїда
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let minCluster = 0;
      for (let c = 0; c < k; c++) {
        let dist = 0;
        for (let j = 0; j < d; j++) {
          dist += Math.pow(data[i][j] - centroids[c][j], 2);
        }
        if (dist < minDist) {
          minDist = dist;
          minCluster = c;
        }
      }
      labels[i] = minCluster;
    }

    // Оновити центроїди
    const sums = Array.from({ length: k }, () => new Array(d).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      counts[labels[i]]++;
      for (let j = 0; j < d; j++) {
        sums[labels[i]][j] += data[i][j];
      }
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let j = 0; j < d; j++) {
          centroids[c][j] = sums[c][j] / counts[c];
        }
      }
    }
  }

  return { labels, centroids };
}
