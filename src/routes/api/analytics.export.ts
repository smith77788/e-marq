/**
 * GET /api/analytics/export
 *
 * Експорт аналітичних даних у CSV.
 *
 * Query params:
 * - type: revenue | customers | products
 * - start: ISO date
 * - end: ISO date
 */
import { createFileRoute } from "@tanstack/react-router";
import { exportRevenueReport, exportCustomerReport, exportProductReport } from "@/lib/acos/analyticsExport";

export const Route = createFileRoute("/api/analytics/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const type = url.searchParams.get("type") ?? "revenue";
        const tenantId = url.searchParams.get("tenant_id");
        const start = url.searchParams.get("start") ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
        const end = url.searchParams.get("end") ?? new Date().toISOString();

        if (!tenantId) {
          return Response.json({ error: "tenant_id required" }, { status: 400 });
        }

        let csv = "";
        let filename = "";

        switch (type) {
          case "revenue":
            csv = await exportRevenueReport(tenantId, start, end);
            filename = `revenue-${start.split("T")[0]}-${end.split("T")[0]}.csv`;
            break;
          case "customers":
            csv = await exportCustomerReport(tenantId);
            filename = `customers-${new Date().toISOString().split("T")[0]}.csv`;
            break;
          case "products":
            csv = await exportProductReport(tenantId);
            filename = `products-${new Date().toISOString().split("T")[0]}.csv`;
            break;
          default:
            return Response.json({ error: "Invalid type" }, { status: 400 });
        }

        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
        });
      },
    },
  },
});
