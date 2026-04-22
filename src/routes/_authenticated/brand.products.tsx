/**
 * Brand → Products. Owner-facing catalog management for the active tenant
 * (selected via `?tenant=` search param, just like `/brand`).
 *
 * Reuses the existing <ProductForm /> in a Sheet for create + edit. RLS lets
 * any tenant admin/owner CRUD products inside their own tenant; super_admin
 * sees everything.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProductForm, type ProductFormValues } from "@/components/admin/ProductForm";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/i18n";
import { formatMoneyExact } from "@/lib/money";

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  price_cents: number;
  currency: string;
  stock: number;
  is_active: boolean;
  description: string | null;
  image_url: string | null;
  created_at: string;
};

type Search = { tenant?: string };
type Filter = "all" | "active" | "draft" | "oos";

export const Route = createFileRoute("/_authenticated/brand/products")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: BrandProductsPage,
});

function BrandProductsPage() {
  const { tenant: tenantId } = useSearch({ from: "/_authenticated/brand/products" });
  const { user, loading } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const tenantsQuery = useQuery({
    queryKey: ["my-tenants", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Auto-select first tenant when not in URL
  if (!loading && tenantsQuery.data && tenantsQuery.data.length > 0 && !tenantId) {
    void navigate({
      to: "/brand/products",
      search: { tenant: tenantsQuery.data[0].id },
      replace: true,
    });
  }

  const current = tenantsQuery.data?.find((tt) => tt.id === tenantId);

  const productsQuery = useQuery({
    queryKey: ["brand-products", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, name, sku, price_cents, currency, stock, is_active, description, image_url, created_at",
        )
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [deleting, setDeleting] = useState<ProductRow | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["brand-products", tenantId] });

  const createMutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const { error } = await supabase.from("products").insert({
        tenant_id: tenantId!,
        name: values.name,
        sku: values.sku || null,
        price_cents: values.price_cents,
        currency: values.currency,
        stock: values.stock,
        description: values.description || null,
        image_url: values.image_url || null,
        is_active: values.is_active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("bp.created"));
      setCreateOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || t("bp.failed")),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: ProductFormValues }) => {
      const { error } = await supabase
        .from("products")
        .update({
          name: values.name,
          sku: values.sku || null,
          price_cents: values.price_cents,
          currency: values.currency,
          stock: values.stock,
          description: values.description || null,
          image_url: values.image_url || null,
          is_active: values.is_active,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("bp.updated"));
      setEditing(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || t("bp.failed")),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      // Soft archive — keeps order history intact.
      const { error } = await supabase.from("products").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("bp.deleted"));
      setDeleting(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || t("bp.failed")),
  });

  const filtered = useMemo(() => {
    const list = productsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((p) => {
      if (filter === "active" && !p.is_active) return false;
      if (filter === "draft" && p.is_active) return false;
      if (filter === "oos" && p.stock > 0) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q);
    });
  }, [productsQuery.data, search, filter]);

  if (loading) return <p className="text-sm text-muted-foreground">Завантаження…</p>;

  if (!tenantsQuery.data || tenantsQuery.data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>У вас ще немає бренду</CardTitle>
          <CardDescription>
            Попросіть супер-адміністратора створити бренд і призначити вас власником.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!current) {
    return <p className="text-sm text-muted-foreground">Завантажую бренд…</p>;
  }

  const products = productsQuery.data ?? [];
  const isEmpty = !productsQuery.isLoading && products.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("bp.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("bp.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/s/$slug" params={{ slug: current.slug }} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              /s/{current.slug}
            </Link>
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("bp.new")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-3 pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("bp.search")}
                className="h-9 pl-8 text-sm"
              />
            </div>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList className="h-9">
                <TabsTrigger value="all" className="text-xs">
                  {t("bp.tab.all")}
                </TabsTrigger>
                <TabsTrigger value="active" className="text-xs">
                  {t("bp.tab.active")}
                </TabsTrigger>
                <TabsTrigger value="draft" className="text-xs">
                  {t("bp.tab.draft")}
                </TabsTrigger>
                <TabsTrigger value="oos" className="text-xs">
                  {t("bp.tab.oos")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isEmpty ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t("bp.empty.title")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("bp.empty.desc")}</p>
              <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t("bp.new")}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">{t("bp.col.image")}</TableHead>
                  <TableHead>{t("bp.col.name")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("bp.col.sku")}</TableHead>
                  <TableHead className="text-right">{t("bp.col.price")}</TableHead>
                  <TableHead className="text-right">{t("bp.col.stock")}</TableHead>
                  <TableHead>{t("bp.col.status")}</TableHead>
                  <TableHead className="w-[100px] text-right">{t("bp.col.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.name}
                          loading="lazy"
                          decoding="async"
                          width={40}
                          height={40}
                          className="h-10 w-10 rounded object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded bg-muted" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        to="/brand/products/$productId"
                        params={{ productId: p.id }}
                        search={{ tenant: tenantId }}
                        className="hover:underline hover:text-primary"
                      >
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                      {p.sku ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoneyExact(p.price_cents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={p.stock === 0 ? "text-destructive" : undefined}>
                        {p.stock}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.is_active ? "default" : "outline"}>
                        {p.is_active ? t("bp.status.active") : t("bp.status.draft")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setEditing(p)}
                        aria-label="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleting(p)}
                        aria-label="Archive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("bp.create.title")}</SheetTitle>
            <SheetDescription>{current.name}</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <ProductForm
              onSubmit={(values) => createMutation.mutate(values)}
              onCancel={() => setCreateOpen(false)}
              isPending={createMutation.isPending}
              submitLabel={t("bp.new")}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit */}
      <Sheet open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("bp.edit.title")}</SheetTitle>
            <SheetDescription>{editing?.name}</SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="mt-6">
              <ProductForm
                initialValues={{
                  name: editing.name,
                  sku: editing.sku ?? "",
                  price_cents: editing.price_cents,
                  currency: editing.currency,
                  stock: editing.stock,
                  description: editing.description ?? "",
                  image_url: editing.image_url ?? "",
                  is_active: editing.is_active,
                }}
                onSubmit={(values) => updateMutation.mutate({ id: editing.id, values })}
                onCancel={() => setEditing(null)}
                isPending={updateMutation.isPending}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Archive confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bp.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} — {t("bp.delete.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Скасувати</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && archiveMutation.mutate(deleting.id)}
              disabled={archiveMutation.isPending}
            >
              {archiveMutation.isPending ? "…" : t("bp.deleted")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
