import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  message: z.string().trim().min(1).max(4000),
  website: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/api/public/contact")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => null);
          const parsed = schema.safeParse(body);
          if (!parsed.success) {
            return new Response(
              JSON.stringify({ ok: false, error: "Invalid input", issues: parsed.error.flatten() }),
              { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }
          const { name, email, message, website } = parsed.data;

          const { error } = await supabaseAdmin.from("lead_prospects").insert({
            source: "contact_form",
            name,
            email,
            website_url: website ?? null,
            notes: message,
            status: "discovered",
            fit_score: 60,
            signals: { channel: "marketing_site", message_preview: message.slice(0, 200) },
          });

          if (error) {
            console.error("contact form insert failed", error);
            return new Response(JSON.stringify({ ok: false, error: "Storage failed" }), {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS },
            });
          }

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        } catch (err) {
          console.error("contact form error", err);
          return new Response(JSON.stringify({ ok: false, error: "Server error" }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
      },
    },
  },
});
