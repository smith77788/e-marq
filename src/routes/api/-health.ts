/**
 * Smart API Endpoints — готові API ендпоінти.
 *
 * Ендпоінти:
 * 1. GET /api/health — перевірка стану
 * 2. GET /api/metrics — метрики системи
 * 3. GET /api/analytics — аналітика
 * 4. POST /api/events — трекінг подій
 */
import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/health — Health check endpoint.
 */
export const HealthRoute = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          status: "healthy",
          version: "1.0.0",
          timestamp: new Date().toISOString(),
        });
      },
    },
  },
});

/**
 * GET /api/metrics — System metrics endpoint.
 */
export const MetricsRoute = createFileRoute("/api/metrics")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          ok: true,
          data: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString(),
          },
        });
      },
    },
  },
});
