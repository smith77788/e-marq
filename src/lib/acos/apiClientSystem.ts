/**
 * Smart API Client — клієнт для API запитів.
 *
 * Можливості:
 * 1. GET/POST/PUT/DELETE запити
 * 2. Автоматичний retry
 * 3. Кешування відповідей
 * 4. Обробка помилок
 */

export type ApiClientConfig = {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  retries?: number;
};

export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  cache?: boolean;
  cacheTtlMs?: number;
};

export class ApiClient {
  private config: ApiClientConfig;
  private cache = new Map<string, { data: unknown; expires: number }>();

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  async post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, { ...options, body });
  }

  async put<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", path, { ...options, body });
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  private async request<T>(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const cacheKey = `${method}:${url}`;

    // Check cache
    if (method === "GET" && options?.cache !== false) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() < cached.expires) {
        return cached.data as T;
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options?.headers,
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    let lastError: Error | undefined;
    const maxRetries = this.config.retries ?? 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs ?? 10_000,
        );

        const response = await fetch(url, {
          method,
          headers,
          body: options?.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as T;

        // Cache successful GET responses
        if (method === "GET") {
          this.cache.set(cacheKey, {
            data,
            expires: Date.now() + (options?.cacheTtlMs ?? 5 * 60 * 1000),
          });
        }

        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
