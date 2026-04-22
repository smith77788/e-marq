/**
 * MagnetPreviewDialog — показує повний контент lead_magnet inline у модалі,
 * без переходу на окрему сторінку /m/<slug>.
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Sparkles, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { renderMarkdown } from "@/lib/markdown";

type FullMagnet = {
  id: string;
  slug: string;
  title: string;
  meta_description: string | null;
  body_md: string;
  topic: string | null;
  keywords: string[];
  cta_url: string;
  views_count: number;
  signups_attributed: number;
  is_published: boolean;
};

interface Props {
  slug: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function MagnetPreviewDialog({ slug, open, onOpenChange }: Props) {
  const q = useQuery({
    enabled: Boolean(slug && open),
    queryKey: ["magnet-preview", slug],
    queryFn: async () => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from("lead_magnets")
        .select(
          "id, slug, title, meta_description, body_md, topic, keywords, cta_url, views_count, signups_attributed, is_published",
        )
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data as FullMagnet | null;
    },
  });

  const m = q.data;
  const html = m ? renderMarkdown(m.body_md ?? "") : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="space-y-2 border-b border-border bg-gradient-to-br from-primary/10 via-background to-background p-5">
          {m?.topic && (
            <Badge variant="outline" className="w-fit border-primary/30 bg-primary/5 text-primary">
              <Sparkles className="mr-1 h-3 w-3" />
              {m.topic}
            </Badge>
          )}
          <DialogTitle className="text-xl sm:text-2xl text-left">
            {q.isLoading ? "Завантаження…" : (m?.title ?? "Магніт не знайдено")}
          </DialogTitle>
          {m?.meta_description && (
            <DialogDescription className="text-left text-sm">
              {m.meta_description}
            </DialogDescription>
          )}
          {m && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pt-1">
              <span>👁 {m.views_count}</span>
              <span>✨ {m.signups_attributed}</span>
              <Badge variant="outline" className="text-[10px]">
                /m/{m.slug}
              </Badge>
              {!m.is_published && (
                <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">
                  draft
                </Badge>
              )}
            </div>
          )}
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[60vh]">
          <div className="p-5">
            {q.isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Завантаження контенту…
              </div>
            ) : q.error ? (
              <p className="text-sm text-destructive">Помилка: {(q.error as Error).message}</p>
            ) : !m ? (
              <p className="text-sm text-muted-foreground">Магніт не знайдено або вимкнено.</p>
            ) : (
              <>
                <div
                  className="prose prose-sm prose-zinc max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground/90 prose-li:text-foreground/90"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
                {m.keywords?.length > 0 && (
                  <div className="mt-6 flex flex-wrap gap-1 pt-4 border-t border-border">
                    {m.keywords.map((k) => (
                      <Badge key={k} variant="outline" className="text-[10px]">
                        {k}
                      </Badge>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        {m && (
          <div className="border-t border-border bg-muted/20 p-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Публічна версія сторінки: <code className="rounded bg-muted px-1">/m/{m.slug}</code>
            </p>
            <Button asChild variant="outline" size="sm">
              <a href={`/m/${m.slug}`} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Відкрити публічну сторінку
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
