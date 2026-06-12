/**
 * Product Variants management panel.
 *
 * The product itself stays as the master record (price, stock, image). When
 * a product has variants, each variant overrides price/stock/image for that
 * specific combination of options (e.g. "Розмір: 100г").
 *
 * Toggle `has_variants` on the product row to flip the storefront UI from
 * single-buy to variant selector.
 *
 * Up to 3 option dimensions (e.g. Розмір × Колір × Смак) — matches the DB
 * schema which has option_{1,2,3}_name/_value columns.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatMoneyExact } from "@/lib/money";

type Variant = {
  id: string;
  sku: string | null;
  option_1_name: string | null;
  option_1_value: string | null;
  option_2_name: string | null;
  option_2_value: string | null;
  option_3_name: string | null;
  option_3_value: string | null;
  price_cents: number;
  compare_at_price_cents: number | null;
  stock: number;
  is_active: boolean;
};

type Props = {
  tenantId: string;
  productId: string;
  hasVariants: boolean;
};

type FormState = {
  sku: string;
  o1n: string;
  o1v: string;
  o2n: string;
  o2v: string;
  o3n: string;
  o3v: string;
  price: string; // dollars
  compareAt: string;
  stock: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  sku: "",
  o1n: "",
  o1v: "",
  o2n: "",
  o2v: "",
  o3n: "",
  o3v: "",
  price: "0.00",
  compareAt: "",
  stock: "0",
  isActive: true,
};

function variantLabel(v: Variant): string {
  const parts = [
    v.option_1_value && `${v.option_1_name ?? ""}: ${v.option_1_value}`.trim(),
    v.option_2_value && `${v.option_2_name ?? ""}: ${v.option_2_value}`.trim(),
    v.option_3_value && `${v.option_3_name ?? ""}: ${v.option_3_value}`.trim(),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : (v.sku ?? "Варіант");
}

export function ProductVariantsPanel({ tenantId, productId, hasVariants }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Variant | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Variant | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const variantsQuery = useQuery({
    queryKey: ["product-variants", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_variants")
        .select(
          "id, sku, option_1_name, option_1_value, option_2_name, option_2_value, option_3_name, option_3_value, price_cents, compare_at_price_cents, stock, is_active",
        )
        .eq("product_id", productId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Variant[];
    },
  });

  const variants = variantsQuery.data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["product-variants", productId] });

  const toggleHasVariants = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from("products")
        .update({ has_variants: next })
        .eq("id", productId)
        .eq("tenant_id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Збережено");
      qc.invalidateQueries({ queryKey: ["brand-product", productId] });
      qc.invalidateQueries({ queryKey: ["brand-products", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openCreate() {
    // Pre-fill option names from the first existing variant so all variants
    // share the same option dimensions (Shopify-like UX).
    const tpl = variants[0];
    setForm({
      ...EMPTY_FORM,
      o1n: tpl?.option_1_name ?? "",
      o2n: tpl?.option_2_name ?? "",
      o3n: tpl?.option_3_name ?? "",
    });
    setCreating(true);
  }

  function openEdit(v: Variant) {
    setForm({
      sku: v.sku ?? "",
      o1n: v.option_1_name ?? "",
      o1v: v.option_1_value ?? "",
      o2n: v.option_2_name ?? "",
      o2v: v.option_2_value ?? "",
      o3n: v.option_3_name ?? "",
      o3v: v.option_3_value ?? "",
      price: (v.price_cents / 100).toFixed(2),
      compareAt:
        v.compare_at_price_cents != null ? (v.compare_at_price_cents / 100).toFixed(2) : "",
      stock: String(v.stock),
      isActive: v.is_active,
    });
    setEditing(v);
  }

  function close() {
    setCreating(false);
    setEditing(null);
  }

  function buildPayload() {
    const priceNum = Number(form.price);
    const compareNum = form.compareAt ? Number(form.compareAt) : null;
    const stockNum = Number(form.stock);
    if (!Number.isFinite(priceNum) || priceNum < 0) throw new Error("Ціна має бути числом ≥ 0");
    if (compareNum != null && (!Number.isFinite(compareNum) || compareNum < 0))
      throw new Error("Ціна до знижки має бути числом ≥ 0");
    if (!Number.isInteger(stockNum) || stockNum < 0) throw new Error("Залишок має бути цілим ≥ 0");
    return {
      sku: form.sku.trim() || null,
      option_1_name: form.o1n.trim() || null,
      option_1_value: form.o1v.trim() || null,
      option_2_name: form.o2n.trim() || null,
      option_2_value: form.o2v.trim() || null,
      option_3_name: form.o3n.trim() || null,
      option_3_value: form.o3v.trim() || null,
      price_cents: Math.round(priceNum * 100),
      compare_at_price_cents: compareNum != null ? Math.round(compareNum * 100) : null,
      stock: stockNum,
      is_active: form.isActive,
    };
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      const { error } = await supabase.from("product_variants").insert({
        ...payload,
        tenant_id: tenantId,
        product_id: productId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Варіант додано");
      close();
      invalidate();
      // Auto-enable has_variants when adding the first one.
      if (variants.length === 0 && !hasVariants) toggleHasVariants.mutate(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const payload = buildPayload();
      const { error } = await supabase
        .from("product_variants")
        .update(payload)
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Збережено");
      close();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (v: Variant) => {
      const { error } = await supabase.from("product_variants").delete().eq("id", v.id);
      if (error) throw error;
      // Auto-disable has_variants when none remain.
      if (variants.length === 1) await toggleHasVariants.mutateAsync(false);
    },
    onSuccess: () => {
      toast.success("Варіант видалено");
      setDeleting(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const formOpen = creating || !!editing;
  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Варіанти</CardTitle>
            <CardDescription>
              Розмір, смак, колір. Кожен варіант має власну ціну та залишок.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="has-variants" className="text-xs text-muted-foreground">
              Увімкнено
            </Label>
            <Switch
              id="has-variants"
              checked={hasVariants}
              onCheckedChange={(v) => toggleHasVariants.mutate(v)}
              disabled={toggleHasVariants.isPending}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-end">
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Додати варіант
          </Button>
        </div>

        {variantsQuery.isLoading ? (
          <TableSkeleton rows={3} columns={5} />
        ) : variants.length === 0 ? (
          <div className="rounded-md border border-dashed py-12 text-center">
            <p className="text-sm font-medium text-foreground">Ще немає варіантів</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Додайте перший варіант — наприклад «Розмір 100г».
            </p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Варіант</TableHead>
                  <TableHead className="hidden md:table-cell">SKU</TableHead>
                  <TableHead className="text-right">Ціна</TableHead>
                  <TableHead className="text-right">Залишок</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="w-[80px] text-right">Дії</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{variantLabel(v)}</TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                      {v.sku ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoneyExact(v.price_cents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={v.stock === 0 ? "text-destructive" : undefined}>
                        {v.stock}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={v.is_active ? "default" : "outline"}>
                        {v.is_active ? "Активний" : "Прихований"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => openEdit(v)}
                        aria-label="Редагувати"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleting(v)}
                        aria-label="Видалити"
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

      {/* Create / edit dialog */}
      <Dialog open={formOpen} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Редагувати варіант" : "Новий варіант"}</DialogTitle>
            <DialogDescription>
              Назва опції (напр. «Розмір») і її значення (напр. «100 г»).
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                if (editing) updateMutation.mutate();
                else createMutation.mutate();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Помилка");
              }
            }}
          >
            <div className="space-y-3 rounded-md border p-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Опція 1 (назва)</Label>
                  <Input
                    value={form.o1n}
                    onChange={(e) => setForm({ ...form, o1n: e.target.value })}
                    placeholder="Розмір"
                    maxLength={50}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Значення</Label>
                  <Input
                    value={form.o1v}
                    onChange={(e) => setForm({ ...form, o1v: e.target.value })}
                    placeholder="100 г"
                    maxLength={50}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Опція 2 (опц.)</Label>
                  <Input
                    value={form.o2n}
                    onChange={(e) => setForm({ ...form, o2n: e.target.value })}
                    maxLength={50}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Значення</Label>
                  <Input
                    value={form.o2v}
                    onChange={(e) => setForm({ ...form, o2v: e.target.value })}
                    maxLength={50}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Опція 3 (опц.)</Label>
                  <Input
                    value={form.o3n}
                    onChange={(e) => setForm({ ...form, o3n: e.target.value })}
                    maxLength={50}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Значення</Label>
                  <Input
                    value={form.o3v}
                    onChange={(e) => setForm({ ...form, o3v: e.target.value })}
                    maxLength={50}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="v-sku">SKU</Label>
                <Input
                  id="v-sku"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  maxLength={100}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="v-stock">Залишок</Label>
                <Input
                  id="v-stock"
                  type="number"
                  step="1"
                  min="0"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="v-price">Ціна</Label>
                <Input
                  id="v-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="v-compare">Ціна до знижки</Label>
                <Input
                  id="v-compare"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.compareAt}
                  onChange={(e) => setForm({ ...form, compareAt: e.target.value })}
                  placeholder="—"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="v-active" className="cursor-pointer text-sm">
                У продажу
              </Label>
              <Switch
                id="v-active"
                checked={form.isActive}
                onCheckedChange={(v) => setForm({ ...form, isActive: v })}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={submitting}>
                Скасувати
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Зберігаю…" : "Зберегти"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Видалити варіант?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && variantLabel(deleting)} — повернути неможливо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Скасувати</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "…" : "Видалити"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
