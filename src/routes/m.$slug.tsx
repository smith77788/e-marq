/**
 * Публічний контент-магніт — посадкова SEO-сторінка для залучення нових
 * брендів до MARQ. Відкривається без авторизації.
 */
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Magnet = {
  id: string;
  slug: string;
  title: string;
  meta_description: string | null;
  body_md: string;
  topic: string | null;
  keywords: string[];
  cta_url: string;
};

export const Route = createFileRoute("/m/$slug")({
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("lead_magnets")
      .select("id, slug, title, meta_description, body_md, topic, keywords, cta_url")
      .eq("slug", params.slug)
      .eq("is_published", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    return { magnet: data as Magnet };
  },
  head: ({ loaderData }) => {
    const m = loaderData?.magnet;
    return {
      meta: [
        { title: m?.title ?? "MARQ" },
        { name: "description", content: m?.meta_description ?? "" },
        { property: "og:title", content: m?.title ?? "MARQ" },
        { property: "og:description", content: m?.meta_description ?? "" },
      ],
    };
  },
  component: MagnetPage,
  notFoundComponent: () => (
    <main className="mx-auto max-w-2xl px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Сторінка не знайдена</h1>
      <p className="mt-2 text-muted-foreground">
        Можливо її вимкнули. Повертайтеся на{" "}
        <Link to="/" className="text-primary underline">
          головну
        </Link>
        .
      </p>
    </main>
  ),
});

function MagnetPage() {
  const { magnet } = Route.useLoaderData();

  // дуже простий markdown → HTML (заголовки, абзаци, списки)
  const html = renderMarkdown(magnet.body_md);

  return (
    <main className="min-h-screen bg-background">
      <section className="border-b border-border bg-gradient-to-br from-primary/10 via-background to-background">
        <div className="mx-auto max-w-3xl px-4 py-16">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="mr-1 h-3 w-3" />
            {magnet.topic ?? "Гайд"}
          </Badge>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground">
            {magnet.title}
          </h1>
          {magnet.meta_description && (
            <p className="mt-4 max-w-2xl text-base text-muted-foreground">
              {magnet.meta_description}
            </p>
          )}
        </div>
      </section>

      <article className="mx-auto max-w-3xl px-4 py-12">
        <div
          className="prose prose-zinc max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground/90"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        <div className="mt-12 rounded-xl border border-primary/30 bg-primary/5 p-6 text-center">
          <h3 className="text-lg font-semibold text-foreground">
            Хочете автоматизувати це у своєму магазині?
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            MARQ робить це автоматично — 90+ AI-агентів працюють для вас 24/7.
          </p>
          <Button asChild size="lg" className="mt-4">
            <Link to={magnet.cta_url || "/signup"}>
              Спробувати безкоштовно <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>

        {magnet.keywords.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-1">
            {magnet.keywords.map((k) => (
              <Badge key={k} variant="outline" className="text-[10px]">
                {k}
              </Badge>
            ))}
          </div>
        )}
      </article>
    </main>
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      const m = /^(#{1,6})\s+(.+)$/.exec(line)!;
      const level = m[1].length;
      out.push(`<h${level}>${escapeHtml(m[2])}</h${level}>`);
    } else if (/^[-*]\s/.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${escapeHtml(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}
