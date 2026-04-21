/**
 * Product SEO panel — meta title, meta description, URL handle.
 *
 * Live SERP-style preview helps the merchant see what Google + social
 * snippets will look like before publishing. URL handle auto-generates from
 * the product name on first use, then stays editable.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  tenantId: string;
  tenantSlug: string;
  productId: string;
  productName: string;
  initialSeoTitle: string | null;
  initialSeoDescription: string | null;
  initialUrlHandle: string | null;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function ProductSeoPanel({
  tenantId,
  tenantSlug,
  productId,
  productName,
  initialSeoTitle,
  initialSeoDescription,
  initialUrlHandle,
}: Props) {
  const [seoTitle, setSeoTitle] = useState(initialSeoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(initialSeoDescription ?? "");
  const [urlHandle, setUrlHandle] = useState(initialUrlHandle ?? slugify(productName));

  // Sync local state if the route reloads with new initial data.
  useEffect(() => {
    setSeoTitle(initialSeoTitle ?? "");
    setSeoDescription(initialSeoDescription ?? "");
    setUrlHandle(initialUrlHandle ?? slugify(productName));
  }, [initialSeoTitle, initialSeoDescription, initialUrlHandle, productName]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("products")
        .update({
          seo_title: seoTitle.trim() || null,
          seo_description: seoDescription.trim() || null,
          url_handle: urlHandle.trim() || null,
        })
        .eq("id", productId)
        .eq("tenant_id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => toast.success("SEO збережено"),
    onError: (e: Error) => toast.error(e.message),
  });

  const previewTitle = (seoTitle || productName).slice(0, 60);
  const previewDesc = (seoDescription || `Замовити ${productName}`).slice(0, 160);
  const previewUrl = `${tenantSlug}/products/${urlHandle || productId.slice(0, 8)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">SEO та поширення</CardTitle>
        <CardDescription>Як товар виглядатиме у Google і соцмережах.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Live preview */}
        <div className="rounded-md border bg-muted/30 p-4">
          <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Globe className="h-3 w-3" /> {previewUrl}
          </p>
          <p className="text-base font-medium text-primary line-clamp-1">{previewTitle}</p>
          <p className="text-xs text-muted-foreground line-clamp-2">{previewDesc}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="seo-title">Заголовок (60 симв.)</Label>
          <Input
            id="seo-title"
            value={seoTitle}
            onChange={(e) => setSeoTitle(e.target.value)}
            maxLength={60}
            placeholder={productName}
          />
          <p className="text-[10px] text-muted-foreground">{seoTitle.length}/60</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="seo-desc">Опис (160 симв.)</Label>
          <Textarea
            id="seo-desc"
            value={seoDescription}
            onChange={(e) => setSeoDescription(e.target.value)}
            maxLength={160}
            rows={3}
            placeholder={`Замовити ${productName} на ${tenantSlug}`}
          />
          <p className="text-[10px] text-muted-foreground">{seoDescription.length}/160</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="seo-handle">URL-адреса</Label>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">/s/{tenantSlug}/products/</span>
            <Input
              id="seo-handle"
              value={urlHandle}
              onChange={(e) => setUrlHandle(slugify(e.target.value))}
              maxLength={80}
              placeholder={slugify(productName)}
              className="flex-1 font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Зберігаю…" : "Зберегти SEO"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
