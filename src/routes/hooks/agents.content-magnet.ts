/**
 * Lead Agent: Content Magnet (brand-aware edition)
 *
 * Безкоштовний канал залучення: автоматично генерує SEO-сторінки-гайди
 * (`/m/<slug>`) ПІД ТЕМАТИКУ КОЖНОГО АКТИВНОГО БРЕНДА. Кожен бренд
 * отримує власний пакет магнітів (за категоріями + фірмовий кейс),
 * замість єдиного загального hardcoded набору.
 *
 * Сторінки публічно доступні через /m/<slug>, мають CTA на /signup і дають
 * безкоштовний органічний трафік без реклами.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { authorizeLeadAgent } from "@/lib/lead/auth";
import { getAllTenantBrandContexts } from "@/lib/lead/brandContext";

export const Route = createFileRoute("/hooks/agents/content-magnet")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeLeadAgent(request);
        if ("error" in auth) return jsonError(auth.error, auth.status);

        const contexts = await getAllTenantBrandContexts();
        if (contexts.length === 0) {
          return jsonOk({
            ok: true,
            seeded: 0,
            created: 0,
            note: "Немає активних брендів. Додайте бізнес — і агент згенерує SEO-магніти під його тематику.",
          });
        }

        let seeded = 0;
        let created = 0;
        const perBrand: Record<string, number> = {};
        const usedSlugs = new Set<string>();

        for (const ctx of contexts) {
          for (const m of ctx.magnet_topics) {
            seeded += 1;
            // Унікальний slug у межах бренда + теми
            const baseSlug = `${ctx.profile.slug ?? slugFallback(ctx.profile.brand_name)}-${m.slug_seed}`;
            let slug = baseSlug;
            let suffix = 2;
            while (usedSlugs.has(slug)) {
              slug = `${baseSlug}-${suffix++}`;
            }
            usedSlugs.add(slug);

            const { error } = await supabaseAdmin.from("lead_magnets").upsert(
              {
                slug,
                title: m.title,
                meta_description: m.meta_description,
                topic: m.topic,
                keywords: m.keywords,
                body_md: m.body_md,
                cta_url: "/signup",
                is_published: true,
              },
              { onConflict: "slug", ignoreDuplicates: true } as never,
            );
            if (!error) {
              created += 1;
              perBrand[ctx.profile.brand_name] = (perBrand[ctx.profile.brand_name] ?? 0) + 1;
            }
          }
        }

        return jsonOk({
          ok: true,
          tenants: contexts.length,
          seeded,
          created,
          per_brand: perBrand,
        });
      },
    },
  },
});

function slugFallback(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9а-яіїєґ]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "brand"
  );
}
