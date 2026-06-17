/**
 * Smart Capacity Planning — планування потужностей API.
 *
 * Метрики:
 * 1. CPU usage — використання CPU
 * 2. Memory usage — використання пам'яті
 * 3. Request throughput — пропускна здатність
 * 4. Connection pool — пул з'єднань
 */

export type CapacityMetrics = {
  cpu: {
    usage: number;
    cores: number;
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  connections: {
    active: number;
    idle: number;
    max: number;
  };
  throughput: {
    current: number;
    max: number;
    percentage: number;
  };
};

/**
 * Отримати метрики потужностей.
 */
export function getCapacityMetrics(): CapacityMetrics {
  const mem = process.memoryUsage();

  return {
    cpu: {
      usage: process.cpuUsage().user / 1000000, // Convert to seconds
      cores: require("os").cpus().length,
    },
    memory: {
      used: mem.heapUsed,
      total: mem.heapTotal,
      percentage: Math.round((mem.heapUsed / mem.heapTotal) * 100),
    },
    connections: {
      active: 0,
      idle: 0,
      max: 100,
    },
    throughput: {
      current: 0,
      max: 1000,
      percentage: 0,
    },
  };
}

/**
 * Прогнозувати потребу в ресурсах.
 */
export function forecastCapacity(
  currentMetrics: CapacityMetrics,
  growthRate: number,
  days: number,
): {
  cpuForecast: number;
  memoryForecast: number;
  recommendations: string[];
} {
  const cpuForecast = currentMetrics.cpu.usage * Math.pow(1 + growthRate, days);
  const memoryForecast = currentMetrics.memory.used * Math.pow(1 + growthRate, days);

  const recommendations: string[] = [];

  if (cpuForecast > currentMetrics.cpu.cores * 0.8) {
    recommendations.push("Розгляньте масштабування CPU");
  }
  if (memoryForecast > currentMetrics.memory.total * 0.8) {
    recommendations.push("Розгляньте збільшення пам'яті");
  }

  return { cpuForecast, memoryForecast, recommendations };
}
