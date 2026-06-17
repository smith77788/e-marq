/**
 * Smart Environment Management — керування середовищами.
 *
 * Середовища:
 * 1. Development — розробка
 * 2. Staging — тестування
 * 3. Production — виробництво
 */

export type Environment = {
  name: string;
  url: string;
  database: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
};

const ENVIRONMENTS: Record<string, Environment> = {
  development: {
    name: "Development",
    url: "http://localhost:3000",
    database: "marq_dev",
    features: {
      debug: true,
      mockPayments: true,
      skipEmailVerification: true,
    },
    limits: {
      maxUploadSize: 5 * 1024 * 1024,
      maxQueryRows: 1000,
      rateLimitMultiplier: 0.1,
    },
  },
  staging: {
    name: "Staging",
    url: "https://staging.marq.app",
    database: "marq_staging",
    features: {
      debug: false,
      mockPayments: true,
      skipEmailVerification: false,
    },
    limits: {
      maxUploadSize: 10 * 1024 * 1024,
      maxQueryRows: 5000,
      rateLimitMultiplier: 0.5,
    },
  },
  production: {
    name: "Production",
    url: "https://e-marq.lovable.app",
    database: "marq_prod",
    features: {
      debug: false,
      mockPayments: false,
      skipEmailVerification: false,
    },
    limits: {
      maxUploadSize: 20 * 1024 * 1024,
      maxQueryRows: 10000,
      rateLimitMultiplier: 1,
    },
  },
};

/**
 * Отримати конфігурацію середовища.
 */
export function getEnvironment(name: string): Environment | null {
  return ENVIRONMENTS[name] ?? null;
}

/**
 * Отримати поточне середовище.
 */
export function getCurrentEnvironment(): Environment {
  const env = process.env.NODE_ENV ?? "development";
  return ENVIRONMENTS[env] ?? ENVIRONMENTS.development;
}

/**
 * Перевірити чи production.
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Перевірити чи staging.
 */
export function isStaging(): boolean {
  return process.env.NODE_ENV === "staging";
}

/**
 * Перевірити чи development.
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development" || !process.env.NODE_ENV;
}
