/**
 * Brand → Collections (Catalog grouping). Owner-facing CRUD for collections.
 * - Lists existing collections with product counts.
 * - Create / edit via Sheet form: name, handle, description, image, products[].
 * - Soft delete actually deletes the collection row (products survive).
 *
 * Tenant scoping: ?tenant=<id> search param, mirroring /brand/products.
 * RLS: collections_admin_write — only members of the tenant can mutate.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/i18n";

type CollectionRow = {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  product_count: number;
};

type ProductOption = {
  id: string;
  name: string;
};

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand/catalog")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  component: BrandCollectionsPage,
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function BrandCollectionsPage() {
  const { tenant: tenantId } = useSearch({ from: "/_authenticated/brand/catalog" });
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

  if (!loading && tenantsQuery.data && tenantsQuery.data.length > 0 && !tenantId) {
    void navigate({
      to: "/brand/catalog",
      search: { tenant: tenantsQuery.data[0].id },
      replace: true,
    });
  }

  const current = tenantsQuery.data?.find((tt) => tt.id === tenantId);

  const collectionsQuery = useQuery({
    queryKey: ["brand-collections", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collections")
        .select("id, name, handle, description, image_url, is_active")
        .eq("tenant_id", tenantId!)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Fetch product counts per collection in one batched query.
      const ids = (data ?? []).map((c) => c.id);
      const counts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: rows, error: cErr } = await supabase
          .from("collection_products")
          .select("collection_id")
          .in("collection_id", ids);
        if (cErr) throw cErr;
        for (const r of rows ?? []) {
          counts[r.collection_id] = (counts[r.collection_id] ?? 0) + 1;
        }
      }
      return (data ?? []).map((c): CollectionRow => ({ ...c, product_count: counts[c.id] ?? 0 }));
    },
  });

  const productsQuery = useQuery({
    queryKey: ["brand-collections-products", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name")
        .eq("tenant_id", tenantId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ProductOption[];
    },
  });

  const [editing, setEditing] = useState<CollectionRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CollectionRow | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleManual, setHandleManual] = useState(false);
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());

  // Auto-derive handle from name unless user typed one manually
  useEffect(() => {
    if (!handleManual) setHandle(slugify(name));
  }, [name, handleManual]);

  // Hydrate form when opening edit
  useEffect(() => {
    if (!editing && !creating) return;
    if (editing) {
      setName(editing.name);
      setHandle(editing.handle);
      setHandleManual(true);
      setDescription(editing.description ?? "");
      setImageUrl(editing.image_url ?? "");
      setIsActive(editing.is_active);
      // load assignments
      void (async () => {
        const { data, error } = await supabase
          .from("collection_products")
          .select("product_id")
          .eq("collection_id", editing.id);
        if (!error) {
          setSelectedProducts(new Set((data ?? []).map((r) => r.product_id)));
        }
      })();
    } else {
      // creating
      setName("");
      setHandle("");
      setHandleManual(false);
      setDescription("");
      setImageUrl("");
      setIsActive(true);
      setSelectedProducts(new Set());
    }
  }, [editing, creating]);

  const closeForm = () => {
    setEditing(null);
    setCreating(false);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["brand-collections", tenantId] });
  };

  const saveAssignments = async (collectionId: string, productIds: string[]) => {
    // Replace strategy: delete all then insert. Simple, correct, low volume.
    const { error: delErr } = await supabase
      .from("collection_products")
      .delete()
      .eq("collection_id", collectionId);
    if (delErr) throw delErr;
    if (productIds.length === 0) return;
    const rows = productIds.map((pid, idx) => ({
      collection_id: collectionId,
      product_id: pid,
      tenant_id: tenantId!,
      position: idx,
    }));
    const { error: insErr } = await supabase.from("collection_products").insert(rows);
    if (insErr) throw insErr;
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("collections")
        .insert({
          tenant_id: tenantId!,
          name: name.trim(),
          handle: handle.trim() || slugify(name),
          description: description.trim() || null,
          image_url: imageUrl.trim() || null,
          is_active: isActive,
        })
        .select("id")
        .single();
      if (error) throw error;
      await saveAssignments(data.id, Array.from(selectedProducts));
    },
    onSuccess: () => {
      toast.success(t("bc.created"));
      closeForm();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase
        .from("collections")
        .update({
          name: name.trim(),
          handle: handle.trim() || slugify(name),
          description: description.trim() || null,
          image_url: imageUrl.trim() || null,
          is_active: isActive,
        })
        .eq("id", editing.id);
      if (error) throw error;
      await saveAssignments(editing.id, Array.from(selectedProducts));
    },
    onSuccess: () => {
      toast.success(t("bc.updated"));
      closeForm();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("collections").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("bc.deleted"));
      setDeleting(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const collections = collectionsQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const isEmpty = !collectionsQuery.isLoading && collections.length === 0;
  const formOpen = creating || !!editing;
  const submitting = createMutation.isPending || updateMutation.isPending;

  const toggleProduct = (id: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("bc.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("bc.subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("bc.new")}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {collectionsQuery.isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : isEmpty ? (
            <EmptyState
              variant="inline"
              icon={FolderTree}
              title={t("bc.empty.title")}
              description={t("bc.empty.desc")}
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  {t("bc.new")}
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("bc.col.name")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("bc.col.handle")}</TableHead>
                    <TableHead className="text-right">{t("bc.col.products")}</TableHead>
                    <TableHead>{t("bc.col.status")}</TableHead>
                    <TableHead className="w-[100px] text-right">{t("bc.col.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collections.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                        {c.handle}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.product_count}</TableCell>
                      <TableCell>
                        <Badge variant={c.is_active ? "default" : "outline"}>
                          {c.is_active ? "Активна" : "Прихована"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setEditing(c)}
                          aria-label="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleting(c)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / edit form */}
      <Sheet open={formOpen} onOpenChange={(open) => !open && closeForm()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{editing ? t("bc.edit.title") : t("bc.create.title")}</SheetTitle>
            <SheetDescription>{current.name}</SheetDescription>
          </SheetHeader>

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) {
                toast.error("Введіть назву");
                return;
              }
              if (editing) updateMutation.mutate();
              else createMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="c-name">{t("bc.field.name")}</Label>
              <Input
                id="c-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-handle">{t("bc.field.handle")}</Label>
              <Input
                id="c-handle"
                value={handle}
                onChange={(e) => {
                  setHandleManual(true);
                  setHandle(slugify(e.target.value));
                }}
                placeholder="hits"
                maxLength={64}
                required
              />
              <p className="text-xs text-muted-foreground">{t("bc.field.handle.hint")}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-desc">{t("bc.field.description")}</Label>
              <Textarea
                id="c-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={500}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-img">{t("bc.field.image")}</Label>
              <Input
                id="c-img"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://…"
                type="url"
              />
            </div>

            <div className="space-y-2">
              <Label>{t("bc.field.products")}</Label>
              <p className="text-xs text-muted-foreground">{t("bc.field.products.hint")}</p>
              <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                {products.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground">
                    Немає активних товарів. Спочатку створіть товари.
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {products.map((p) => (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={selectedProducts.has(p.id)}
                          onCheckedChange={() => toggleProduct(p.id)}
                        />
                        <span className="flex-1 truncate">{p.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Обрано: <span className="font-medium">{selectedProducts.size}</span>
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label htmlFor="c-active" className="cursor-pointer">
                {t("bc.field.active")}
              </Label>
              <Switch id="c-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={closeForm}>
                Скасувати
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "…" : editing ? "Зберегти" : t("bc.new")}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bc.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} — {t("bc.delete.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Скасувати</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "…" : t("bc.deleted")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
