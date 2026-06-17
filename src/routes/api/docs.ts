/**
 * GET /api/docs
 *
 * Автоматична документація API для MARQ.
 * Повертає OpenAPI/Swagger spec.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/docs")({
  server: {
    handlers: {
      GET: async () => {
        const spec = {
          openapi: "3.0.0",
          info: {
            title: "MARQ API",
            description: "Revenue OS for D2C brands — 70+ AI agents",
            version: "1.0.0",
          },
          servers: [
            { url: "https://e-marq.lovable.app", description: "Production" },
          ],
          paths: {
            "/api/analytics/smart": {
              post: {
                summary: "Get smart analytics dashboard data",
                tags: ["Analytics"],
                requestBody: {
                  content: {
                    "application/json": {
                      schema: { type: "object", properties: { tenant_id: { type: "string" } } },
                    },
                  },
                },
                responses: { 200: { description: "Dashboard data" } },
              },
            },
            "/api/ai/ask": {
              post: {
                summary: "Ask AI assistant about your business",
                tags: ["AI"],
                requestBody: {
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: { tenant_id: { type: "string" }, question: { type: "string" } },
                      },
                    },
                  },
                },
                responses: { 200: { description: "AI response" } },
              },
            },
            "/api/public/payments/liqpay-init": {
              post: {
                summary: "Initialize LiqPay payment",
                tags: ["Payments"],
                responses: { 200: { description: "Payment form data" } },
              },
            },
            "/api/public/marq/events": {
              post: {
                summary: "Track storefront events",
                tags: ["Analytics"],
                responses: { 200: { description: "Event tracked" } },
              },
            },
          },
        };

        return Response.json(spec, {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
