/**
 * Smart Config Management — керування конфігурацією додатку.
 *
 * Функції:
 * 1. Environment variables — змінні оточення
 * 2. Feature flags — прапорці функцій
 * 3. Runtime config — конфігурація часу виконання
 * 4. Config validation — валідація конфігурації
 */

export type AppConfig = {
  env: "development" | "staging" | "production";
  debug: boolean;
  logLevel: string;
  features: Record<string, boolean>;
  limits: {
    maxUploadSize: number;
    maxQueryRows: number;
    sessionTimeout: number;
  };
};

const defaultConfig: AppConfig = {
  env: "production",
  debug: false,
  logLevel: "info",
  features: {
    aiAgents: true,
    emailAutomation: true,
    telegramBot: true,
    analytics: true,
    storefront: true,
  },
  limits: {
    maxUploadSize: 10 * 1024 * 1024, // 10MB
    maxQueryRows: 10000,
    sessionTimeout: 24 * 60 * 60, // 24 hours
  },
};

let config: AppConfig = { ...defaultConfig };

/**
 * Завантажити конфігурацію.
 */
export function loadConfig(): AppConfig {
  return { ...config };
}

/**
 * Оновити конфігурацію.
 */
export function updateConfig(updates: Partial<AppConfig>): void {
  config = { ...config, ...updates };
}

/**
 * Перевірити feature flag.
 */
export function isFeatureEnabled(feature: string): boolean {
  return config.features[feature] ?? false;
}

/**
 * Увімкнути feature flag.
 */
export function enableFeatureFlag(feature: string): void {
  config.features[feature] = true;
}

/**
 * Вимкнути feature flag.
 */
export function disableFeatureFlag(feature: string): void {
  config.features[feature] = false;
}

/**
 * Отримати обмеження.
 */
export function getLimits(): AppConfig["limits"] {
  return config.limits;
}

/**
 * Валідувати конфігурацію.
 */
export function validateConfig(cfg: Partial<AppConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (cfg.env && !["development", "staging", "production"].includes(cfg.env)) {
    errors.push("Invalid environment");
  }

  if (cfg.limits?.maxUploadSize && cfg.limits.maxUploadSize < 0) {
    errors.push("Invalid max upload size");
  }

  if (cfg.limits?.maxQueryRows && cfg.limits.maxQueryRows < 1) {
    errors.push("Invalid max query rows");
  }

  return { valid: errors.length === 0, errors };
}
