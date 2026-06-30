/**
 * GET /api/-health — базова перевірка доступності сервісу.
 * Використовується балансувальниками та моніторингом.
 */
import { createFileRoute } from "@tanstack/react-router";
import { checkApiHealth } from "@/lib/acos/apiHealthSystem";

// @ts-expect-error Route not in generated tree
export const Route = createFileRoute("/api/-health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const checks = await checkApiHealth();
          const allOk = checks.every((c) => c.status === "healthy");
          return Response.json(
            { status: allOk ? "healthy" : "degraded", checks, timestamp: new Date().toISOString() },
            { status: allOk ? 200 : 503 },
          );
        } catch {
          return Response.json({ status: "unhealthy", timestamp: new Date().toISOString() }, { status: 503 });
        }
      },
    },
  },
});
