/**
 * Storefront "FAQ" page (`/s/$slug/faq`).
 *
 * Renders owner-authored question/answer pairs from tenant_configs.ui.faq_items
 * (already returned by get_storefront_config). Items are validated to be
 * { question, answer } strings before rendering.
 */
import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { HelpCircle } from "lucide-react";
import { loadStorefrontShell } from "@/lib/storefront/loaders";
import { canonicalUrl } from "@/lib/seo";

type FaqItem = { question: string; answer: string };

export const Route = createFileRoute("/s/$slug/faq")({
  loader: ({ params }) => loadStorefrontShell(params.slug),
  head: ({ loaderData, params }) => ({
    links: [{ rel: "canonical", href: canonicalUrl(`/s/${params.slug}/faq`) }],
    meta: [{ title: `Часті питання — ${loaderData?.config?.brand_name ?? "Магазин"}` }],
  }),
  errorComponent: ({ error }: { error: Error }) => (
    <div className="mx-auto max-w-3xl px-4 py-12 text-center">
      <p className="text-sm text-destructive">Помилка: {error.message}</p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-3xl px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">Магазин не знайдено.</p>
      <Link to="/" className="mt-3 inline-flex text-sm text-primary underline">
        На головну
      </Link>
    </div>
  ),
  component: FaqPage,
});

function FaqPage() {
  const { slug } = Route.useParams();
  const { config } = Route.useLoaderData();

  const items = useMemo<FaqItem[]>(() => {
    const raw = (config?.ui as { faq_items?: unknown } | null)?.faq_items;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (it): it is FaqItem =>
          !!it &&
          typeof (it as FaqItem).question === "string" &&
          typeof (it as FaqItem).answer === "string" &&
          (it as FaqItem).question.trim().length > 0,
      )
      .map((it) => ({ question: it.question.trim(), answer: it.answer.trim() }));
  }, [config]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-bold tracking-tight text-foreground">Часті питання</h1>
      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((it, i) => (
            <div key={i} className="rounded-xl border border-border/60 bg-card p-4">
              <p className="font-semibold text-foreground">{it.question}</p>
              {it.answer && (
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {it.answer}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/30 py-20 text-center">
          <HelpCircle className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            Питання та відповіді незабаром з'являться.
          </p>
          <Link
            to="/s/$slug"
            params={{ slug }}
            className="mt-3 inline-flex text-sm text-primary underline"
          >
            До каталогу
          </Link>
        </div>
      )}
    </main>
  );
}
