/**
 * Brand → Product detail editor.
 *
 * Full-page deep editor for a single product with 5 tabs:
 *  1. Основне   — name, sku, price, compare_at, stock, currency, weight, tags, status, description
 *  2. Фото      — multi-image upload, primary, reorder, delete (ProductImagesPanel)
 *  3. Варіанти  — variant matrix CRUD (ProductVariantsPanel)
 *  4. SEO       — meta title/desc + URL handle + live SERP preview (ProductSeoPanel)
 *  5. Аналітика — 30-day views/cart/purchases (ProductAnalyticsPanel)
 *
 * The simple Sheet form on /brand/products is kept for fast inline edits;
 * this page exists for the deeper workflow (photos, variants, SEO).
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { ProductImagesPanel } from "@/components/admin/ProductImagesPanel";
import { ProductVariantsPanel } from "@/components/admin/ProductVariantsPanel";
import { ProductSeoPanel } from "@/components/admin/ProductSeoPanel";
import { ProductAnalyticsPanel } from "@/components/admin/ProductAnalyticsPanel";
import { ProductEconomicsPanel } from "@/components/admin/ProductEconomicsPanel";
import { useTenantContext } from "@/hooks/useTenantContext";

type ProductRecord = {
  id: string;
  tenant_id: string;
  name: string;
  sku: string | null;
  description: string | null;
  price_cents: number;
  compare_at_price_cents: number | null;
  currency: string;
  stock: number;
  is_active: boolean;
  has_variants: boolean;
  weight_grams: number | null;
  tags: string[];
  url_handle: string | null;
  seo_title: string | null;
  seo_description: string | null;
};

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand/products/$productId")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: ProductDetailEditor,
});

function ProductDetailEditor() {
  const { productId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { tenants } = useTenantContext();

  const productQuery = useQuery({
    queryKey: ["brand-product", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, tenant_id, name, sku, description, price_cents, compare_at_price_cents, currency, stock, is_active, has_variants, weight_grams, tags, url_handle, seo_title, seo_description",
        )
        .eq("id", productId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      return data as ProductRecord;
    },
  });

  // Lookup tenant slug for the storefront preview link.
  const tenantQuery = useQuery({
    queryKey: ["product-tenant-slug", productQuery.data?.tenant_id],
    enabled: !!productQuery.data?.tenant_id,
    queryFn: async () => {
      const tenant = tenants.find((item) => item.tenant_id === productQuery.data!.tenant_id);
      return tenant ? { slug: tenant.tenant_slug, name: tenant.tenant_name } : null;
    },
  });

  // Local form state for the "Основне" tab.
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [priceDollars, setPriceDollars] = useState("0.00");
  const [compareAt, setCompareAt] = useState("");
  const [currency, setCurrency] = useState("UAH");
  const [stock, setStock] = useState("0");
  const [weight, setWeight] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    const p = productQuery.data;
    if (!p) return;
    setName(p.name);
    setSku(p.sku ?? "");
    setDescription(p.description ?? "");
    setPriceDollars((p.price_cents / 100).toFixed(2));
    setCompareAt(
      p.compare_at_price_cents != null ? (p.compare_at_price_cents / 100).toFixed(2) : "",
    );
    setCurrency(p.currency);
    setStock(String(p.stock));
    setWeight(p.weight_grams != null ? String(p.weight_grams) : "");
    setTagsInput((p.tags ?? []).join(", "));
    setIsActive(p.is_active);
  }, [productQuery.data]);

  const saveBasic = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Назва обовʼязкова");
      const priceNum = Number(priceDollars);
      if (!Number.isFinite(priceNum) || priceNum < 0) throw new Error("Ціна має бути числом ≥ 0");
      const compareNum = compareAt ? Number(compareAt) : null;
      if (compareNum != null && (!Number.isFinite(compareNum) || compareNum < 0))
        throw new Error("Ціна до знижки має бути числом ≥ 0");
      const stockNum = Number(stock);
      if (!Number.isInteger(stockNum) || stockNum < 0)
        throw new Error("Залишок має бути цілим ≥ 0");
      const weightNum = weight ? Number(weight) : null;
      if (weightNum != null && (!Number.isInteger(weightNum) || weightNum < 0))
        throw new Error("Вага має бути цілим ≥ 0");
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, 20);

      const { error } = await supabase
        .from("products")
        .update({
          name: trimmedName,
          sku: sku.trim() || null,
          description: description.trim() || null,
          price_cents: Math.round(priceNum * 100),
          compare_at_price_cents: compareNum != null ? Math.round(compareNum * 100) : null,
          currency: currency.trim().toUpperCase() || "UAH",
          stock: stockNum,
          weight_grams: weightNum,
          tags,
          is_active: isActive,
        })
        .eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Збережено");
      qc.invalidateQueries({ queryKey: ["brand-product", productId] });
      qc.invalidateQueries({ queryKey: ["brand-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (productQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const product = productQuery.data;
  if (!product) return null;
  const tenant = tenantQuery.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2 h-7 text-xs text-muted-foreground"
            onClick={() =>
              navigate({
                to: "/brand/products",
                search: { tenant: product.tenant_id },
              })
            }
          >
            <ArrowLeft className="mr-1 h-3 w-3" />
            До товарів
          </Button>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{product.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={product.is_active ? "default" : "outline"}>
              {product.is_active ? "Активний" : "Чернетка"}
            </Badge>
            {product.has_variants && <Badge variant="secondary">З варіантами</Badge>}
            {product.sku && <span className="font-mono">{product.sku}</span>}
          </div>
        </div>
        {tenant?.slug && (
          <Button asChild variant="outline" size="sm">
            <Link
              to="/s/$slug/products/$productId"
              params={{ slug: tenant.slug, productId: product.id }}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Переглянути у магазині
            </Link>
          </Button>
        )}
      </div>

      <Tabs defaultValue="basic" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-6">
          <TabsTrigger value="basic">Основне</TabsTrigger>
          <TabsTrigger value="images">Фото</TabsTrigger>
          <TabsTrigger value="variants">Варіанти</TabsTrigger>
          <TabsTrigger value="economics">Економіка</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
          <TabsTrigger value="analytics">Аналітика</TabsTrigger>
        </TabsList>

        {/* Tab 1 — Basic */}
        <TabsContent value="basic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Загальні параметри</CardTitle>
              <CardDescription>Назва, ціна, залишок, опис, теги.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="b-name">Назва *</Label>
                <Input
                  id="b-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="b-sku">Артикул (SKU)</Label>
                  <Input
                    id="b-sku"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    maxLength={100}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="b-currency">Валюта</Label>
                  <Input
                    id="b-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    maxLength={8}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="b-price">Ціна</Label>
                  <Input
                    id="b-price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceDollars}
                    onChange={(e) => setPriceDollars(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="b-compare">Ціна до знижки</Label>
                  <Input
                    id="b-compare"
                    type="number"
                    step="0.01"
                    min="0"
                    value={compareAt}
                    onChange={(e) => setCompareAt(e.target.value)}
                    placeholder="—"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="b-stock">Залишок</Label>
                  <Input
                    id="b-stock"
                    type="number"
                    step="1"
                    min="0"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    disabled={product.has_variants}
                  />
                  {product.has_variants && (
                    <p className="text-[10px] text-muted-foreground">Керується через варіанти</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="b-weight">Вага (г)</Label>
                  <Input
                    id="b-weight"
                    type="number"
                    step="1"
                    min="0"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="—"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="b-tags">Теги</Label>
                <Input
                  id="b-tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="новинка, хіт, для собак"
                />
                <p className="text-[10px] text-muted-foreground">Розділяйте комами</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="b-desc">Опис</Label>
                <Textarea
                  id="b-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  maxLength={4000}
                />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label htmlFor="b-active" className="cursor-pointer text-sm">
                    У продажу
                  </Label>
                  <p className="text-xs text-muted-foreground">Видно покупцям у магазині</p>
                </div>
                <Switch id="b-active" checked={isActive} onCheckedChange={setIsActive} />
              </div>

              <div className="flex justify-end">
                <Button onClick={() => saveBasic.mutate()} disabled={saveBasic.isPending}>
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  {saveBasic.isPending ? "Зберігаю…" : "Зберегти"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2 — Images */}
        <TabsContent value="images">
          <ProductImagesPanel
            tenantId={product.tenant_id}
            productId={product.id}
            productName={product.name}
          />
        </TabsContent>

        {/* Tab 3 — Variants */}
        <TabsContent value="variants">
          <ProductVariantsPanel
            tenantId={product.tenant_id}
            productId={product.id}
            hasVariants={product.has_variants}
          />
        </TabsContent>

        {/* Tab — Economics */}
        <TabsContent value="economics">
          <ProductEconomicsPanel
            tenantId={product.tenant_id}
            productId={product.id}
            priceCents={product.price_cents}
            currency={product.currency}
          />
        </TabsContent>

        {/* Tab 4 — SEO */}
        <TabsContent value="seo">
          {tenant?.slug && (
            <ProductSeoPanel
              tenantId={product.tenant_id}
              tenantSlug={tenant.slug}
              productId={product.id}
              productName={product.name}
              initialSeoTitle={product.seo_title}
              initialSeoDescription={product.seo_description}
              initialUrlHandle={product.url_handle}
            />
          )}
        </TabsContent>

        {/* Tab 5 — Analytics */}
        <TabsContent value="analytics">
          <ProductAnalyticsPanel tenantId={product.tenant_id} productId={product.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
