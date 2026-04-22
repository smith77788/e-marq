/**
 * Product Images management panel.
 *
 * Lets the brand owner upload, reorder, mark-primary, and delete product
 * photos. Uploads go to the public `product-images` bucket via
 * `uploadProductImage`. The list is stored in `product_images` (one row per
 * image) — `is_primary` flags the cover image, `position` controls order.
 *
 * The legacy single `products.image_url` column is kept in sync with the
 * primary image so existing storefront list/grid views (which still read
 * `image_url` directly) keep working.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Star, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { deleteProductImage, uploadProductImage } from "@/lib/storage";

type ImageRow = {
  id: string;
  url: string;
  alt: string | null;
  position: number;
  is_primary: boolean;
};

type Props = {
  tenantId: string;
  productId: string;
  productName: string;
};

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];

export function ProductImagesPanel({ tenantId, productId, productName }: Props) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [externalUrl, setExternalUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const imagesQuery = useQuery({
    queryKey: ["product-images", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_images")
        .select("id, url, alt, position, is_primary")
        .eq("product_id", productId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ImageRow[];
    },
  });

  const images = imagesQuery.data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["product-images", productId] });

  /** Sync `products.image_url` with the current primary image so legacy
   * storefront grids that don't read `product_images` still show something. */
  async function syncPrimaryToProduct(url: string | null) {
    await supabase
      .from("products")
      .update({ image_url: url })
      .eq("id", productId)
      .eq("tenant_id", tenantId);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      let nextPos = images.length > 0 ? Math.max(...images.map((i) => i.position)) + 1 : 0;
      let firstUrl: string | null = null;

      for (const file of Array.from(files)) {
        if (!ACCEPTED.includes(file.type)) {
          toast.error(`${file.name}: непідтримуваний формат`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name}: завеликий (>5MB)`);
          continue;
        }
        const url = await uploadProductImage(tenantId, productId, file);
        if (!firstUrl) firstUrl = url;
        const isPrimary = images.length === 0 && nextPos === 0;
        const { error } = await supabase.from("product_images").insert({
          tenant_id: tenantId,
          product_id: productId,
          url,
          alt: productName.slice(0, 200),
          position: nextPos,
          is_primary: isPrimary,
        });
        if (error) {
          toast.error(`${file.name}: ${error.message}`);
          continue;
        }
        nextPos += 1;
      }

      if (images.length === 0 && firstUrl) {
        await syncPrimaryToProduct(firstUrl);
      }

      toast.success("Фото додано");
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Помилка завантаження");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const addExternal = useMutation({
    mutationFn: async () => {
      const url = externalUrl.trim();
      if (!url) throw new Error("Введіть URL");
      const nextPos = images.length > 0 ? Math.max(...images.map((i) => i.position)) + 1 : 0;
      const isPrimary = images.length === 0;
      const { error } = await supabase.from("product_images").insert({
        tenant_id: tenantId,
        product_id: productId,
        url,
        alt: productName.slice(0, 200),
        position: nextPos,
        is_primary: isPrimary,
      });
      if (error) throw error;
      if (isPrimary) await syncPrimaryToProduct(url);
    },
    onSuccess: () => {
      toast.success("Фото додано");
      setExternalUrl("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setPrimary = useMutation({
    mutationFn: async (img: ImageRow) => {
      // Drop primary on all then set on chosen.
      const { error: e1 } = await supabase
        .from("product_images")
        .update({ is_primary: false })
        .eq("product_id", productId);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("product_images")
        .update({ is_primary: true })
        .eq("id", img.id);
      if (e2) throw e2;
      await syncPrimaryToProduct(img.url);
    },
    onSuccess: () => {
      toast.success("Головне фото змінено");
      invalidate();
      qc.invalidateQueries({ queryKey: ["brand-products", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const moveImage = useMutation({
    mutationFn: async ({ img, delta }: { img: ImageRow; delta: -1 | 1 }) => {
      const sorted = [...images].sort((a, b) => a.position - b.position);
      const idx = sorted.findIndex((i) => i.id === img.id);
      const swapIdx = idx + delta;
      if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;
      const a = sorted[idx];
      const b = sorted[swapIdx];
      // Swap positions
      const { error: e1 } = await supabase
        .from("product_images")
        .update({ position: b.position })
        .eq("id", a.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("product_images")
        .update({ position: a.position })
        .eq("id", b.id);
      if (e2) throw e2;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const removeImage = useMutation({
    mutationFn: async (img: ImageRow) => {
      const wasPrimary = img.is_primary;
      const { error } = await supabase.from("product_images").delete().eq("id", img.id);
      if (error) throw error;
      // Best-effort delete from Storage (only for our bucket URLs).
      void deleteProductImage(img.url);
      // If we removed the primary, promote the next image.
      if (wasPrimary) {
        const remaining = images.filter((i) => i.id !== img.id);
        const next = remaining.sort((a, b) => a.position - b.position)[0];
        if (next) {
          await supabase.from("product_images").update({ is_primary: true }).eq("id", next.id);
          await syncPrimaryToProduct(next.url);
        } else {
          await syncPrimaryToProduct(null);
        }
      }
    },
    onSuccess: () => {
      toast.success("Фото видалено");
      invalidate();
      qc.invalidateQueries({ queryKey: ["brand-products", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Фотографії</CardTitle>
        <CardDescription>
          До 5MB на файл. Перше фото використовується як головне у каталозі та соцмережах.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Upload area */}
        <div
          className="rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:bg-accent/30"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleFiles(e.dataTransfer.files);
          }}
        >
          <Upload className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-foreground">Перетягніть файли сюди</p>
          <p className="text-xs text-muted-foreground">JPG, PNG, WebP, AVIF до 5MB</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Завантаження…
              </>
            ) : (
              <>
                <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
                Обрати файли
              </>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED.join(",")}
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
        </div>

        {/* External URL */}
        <div className="space-y-2">
          <Label className="text-xs">Або додайте посилання</Label>
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="https://…"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              maxLength={1000}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addExternal.mutate()}
              disabled={addExternal.isPending || !externalUrl.trim()}
            >
              Додати
            </Button>
          </div>
        </div>

        {/* Gallery */}
        {imagesQuery.isLoading ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading images…"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square animate-pulse rounded-md border bg-primary/10"
              />
            ))}
          </div>
        ) : images.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">Поки що без фото</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {[...images]
              .sort((a, b) => a.position - b.position)
              .map((img, i, arr) => (
                <div
                  key={img.id}
                  className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                >
                  <img
                    src={img.url}
                    alt={img.alt ?? ""}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                  {img.is_primary && (
                    <Badge className="absolute left-1.5 top-1.5 bg-primary text-primary-foreground">
                      <Star className="mr-1 h-3 w-3" /> Головне
                    </Badge>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/60 px-1.5 py-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="flex gap-0.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-white hover:bg-white/20"
                        onClick={() => moveImage.mutate({ img, delta: -1 })}
                        disabled={i === 0}
                        aria-label="Вгору"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-white hover:bg-white/20"
                        onClick={() => moveImage.mutate({ img, delta: 1 })}
                        disabled={i === arr.length - 1}
                        aria-label="Вниз"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex gap-0.5">
                      {!img.is_primary && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-white hover:bg-white/20"
                          onClick={() => setPrimary.mutate(img)}
                          aria-label="Зробити головним"
                        >
                          <Star className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-white hover:bg-destructive/80"
                        onClick={() => removeImage.mutate(img)}
                        aria-label="Видалити"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
