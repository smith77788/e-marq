import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useAuth } from "@/hooks/useAuth";
import { ProductForm, type ProductFormValues } from "@/components/admin/ProductForm";
import {
  TenantConfigForm,
  normalizeConfig,
  type TenantConfigValues,
} from "@/components/admin/TenantConfigForm";
import {
  generateDemoProducts,
  generateDemoOrders,
  generateDemoEvents,
  clearDemoData,
  DEMO_PRODUCT_COUNT,
} from "@/lib/demoData";
import { TenantAnalytics } from "@/components/admin/TenantAnalytics";

export const Route = createFileRoute("/_authenticated/admin/tenants/$tenantId")({
  component: TenantDetailPage,
});

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

function TenantDetailPage() {
  const { tenantId } = Route.useParams();
  const { isSuperAdmin, loading } = useAuth();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [deleting, setDeleting] = useState<ProductRow | null>(null);
  const [demoScale, setDemoScale] = useState<"small" | "medium" | "large">("small");
  const [demoSkipExisting, setDemoSkipExisting] = useState(true);
  const [demoConfirmOpen, setDemoConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const tenantQuery = useQuery({
    queryKey: ["tenant", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, status, owner_user_id, created_at")
        .eq("id", tenantId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const configQuery = useQuery({
    queryKey: ["tenant-config", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_configs")
        .select("brand_name, ui, features, bot, seo, updated_at")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const productsQuery = useQuery({
    queryKey: ["tenant-products", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, name, sku, price_cents, currency, stock, is_active, description, image_url, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProductRow[];
    },
  });

  const eventsQuery = useQuery({
    queryKey: ["tenant-events-count", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const ordersQuery = useQuery({
    queryKey: ["tenant-orders-count", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const invalidateProducts = () =>
    queryClient.invalidateQueries({ queryKey: ["tenant-products", tenantId] });

  const createMutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const { error } = await supabase.from("products").insert({
        tenant_id: tenantId,
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
      toast.success("Product created");
      setCreateOpen(false);
      invalidateProducts();
    },
    onError: (e: Error) => toast.error(e.message),
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
      toast.success("Product updated");
      setEditing(null);
      invalidateProducts();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("products").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidateProducts(),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product deleted");
      setDeleting(null);
      invalidateProducts();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveConfigMutation = useMutation({
    mutationFn: async (values: TenantConfigValues) => {
      const { error } = await supabase
        .from("tenant_configs")
        .update({
          brand_name: values.brand_name,
          ui: values.ui,
          features: values.features,
          bot: values.bot,
          seo: values.seo,
        })
        .eq("tenant_id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Config saved");
      queryClient.invalidateQueries({ queryKey: ["tenant-config", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scaleMultiplier = demoScale === "small" ? 1 : demoScale === "medium" ? 3 : 10;
  const sessionsToCreate = 50 * scaleMultiplier;
  const ordersToCreate = 5 * scaleMultiplier;

  const generateDemoMutation = useMutation({
    mutationFn: async () => {
      const existingProducts = productsQuery.data ?? [];
      const hasData = existingProducts.length > 0;

      if (demoSkipExisting && hasData) {
        throw new Error(
          "Tenant already has data. Disable 'Skip if data exists' or clear demo data first.",
        );
      }

      // 1) Products
      toast.loading("Creating products… (1/3)", { id: "demo-gen" });
      let productIds: string[];
      const productMeta = new Map<string, { name: string; price_cents: number }>();

      if (existingProducts.length >= DEMO_PRODUCT_COUNT) {
        productIds = existingProducts.map((p) => p.id);
        for (const p of existingProducts) {
          productMeta.set(p.id, { name: p.name, price_cents: p.price_cents });
        }
      } else {
        productIds = await generateDemoProducts(tenantId, supabase);
        const { data: fresh, error } = await supabase
          .from("products")
          .select("id, name, price_cents")
          .in("id", productIds);
        if (error) throw error;
        for (const p of fresh ?? []) {
          productMeta.set(p.id, { name: p.name, price_cents: p.price_cents });
        }
      }

      // 2) Orders
      toast.loading("Creating orders… (2/3)", { id: "demo-gen" });
      const orders = await generateDemoOrders(
        tenantId,
        productIds,
        productMeta,
        ordersToCreate,
        supabase,
      );

      // 3) Events
      toast.loading("Generating events… (3/3)", { id: "demo-gen" });
      const eventCount = await generateDemoEvents(
        tenantId,
        productIds,
        orders.map((o) => o.orderId),
        sessionsToCreate,
        supabase,
      );

      return {
        products: productIds.length,
        orders: orders.length,
        events: eventCount,
      };
    },
    onSuccess: (result) => {
      toast.success(
        `Created ${result.products} products, ${result.orders} orders, ${result.events} events`,
        { id: "demo-gen" },
      );
      setDemoConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["tenant-products", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-orders-count", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-events-count", tenantId] });
    },
    onError: (e: Error) => {
      toast.error(e.message, { id: "demo-gen" });
    },
  });

  const clearDemoMutation = useMutation({
    mutationFn: async () => {
      await clearDemoData(tenantId, supabase);
    },
    onSuccess: () => {
      toast.success("Demo data cleared");
      setClearConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["tenant-products", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-orders-count", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-events-count", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!isSuperAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>This page is restricted to super admins.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (tenantQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading tenant…</p>;
  }

  if (tenantQuery.error || !tenantQuery.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tenant not found</CardTitle>
          <CardDescription>This tenant does not exist or you cannot access it.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/admin/tenants" className="text-sm font-medium text-primary hover:underline">
            ← Back to tenants
          </Link>
        </CardContent>
      </Card>
    );
  }

  const tenant = tenantQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/tenants"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          ← Tenants
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{tenant.name}</h1>
          <Badge variant={tenant.status === "active" ? "default" : "outline"}>
            {tenant.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">/{tenant.slug}</p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Products"
              value={productsQuery.data?.length ?? 0}
              loading={productsQuery.isLoading}
            />
            <StatCard label="Orders" value={ordersQuery.data ?? 0} loading={ordersQuery.isLoading} />
            <StatCard label="Events" value={eventsQuery.data ?? 0} loading={eventsQuery.isLoading} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Tenant info</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Tenant ID</dt>
                <dd className="font-mono text-xs text-foreground">{tenant.id}</dd>
                <dt className="text-muted-foreground">Owner user ID</dt>
                <dd className="font-mono text-xs text-foreground">{tenant.owner_user_id}</dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd className="text-foreground">{new Date(tenant.created_at).toLocaleString()}</dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Demo data
              </CardTitle>
              <CardDescription>
                Populate this tenant with realistic demo products, orders, and funnel events
                spread across the last 30 days.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="demo-scale">Scale</Label>
                  <Select
                    value={demoScale}
                    onValueChange={(v) => setDemoScale(v as "small" | "medium" | "large")}
                  >
                    <SelectTrigger id="demo-scale">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Small — 50 sessions, 5 orders</SelectItem>
                      <SelectItem value="medium">Medium — 150 sessions, 15 orders</SelectItem>
                      <SelectItem value="large">Large — 500 sessions, 50 orders</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="demo-skip">Skip if data exists</Label>
                    <p className="text-xs text-muted-foreground">
                      Avoid duplicating data on existing tenants.
                    </p>
                  </div>
                  <Switch
                    id="demo-skip"
                    checked={demoSkipExisting}
                    onCheckedChange={setDemoSkipExisting}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => setDemoConfirmOpen(true)}
                  disabled={generateDemoMutation.isPending}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {generateDemoMutation.isPending ? "Generating…" : "Generate demo data"}
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setClearConfirmOpen(true)}
                  disabled={clearDemoMutation.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {clearDemoMutation.isPending ? "Clearing…" : "Clear demo data"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Products</CardTitle>
                <CardDescription>
                  {productsQuery.data?.length ?? 0} total. Manage catalog for this tenant.
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                + New product
              </Button>
            </CardHeader>
            <CardContent>
              {productsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : productsQuery.data && productsQuery.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productsQuery.data.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-muted-foreground">{p.sku ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {(p.price_cents / 100).toFixed(2)} {p.currency}
                        </TableCell>
                        <TableCell className="text-right">{p.stock}</TableCell>
                        <TableCell>
                          <Switch
                            checked={p.is_active}
                            disabled={toggleMutation.isPending}
                            onCheckedChange={(checked) =>
                              toggleMutation.mutate({ id: p.id, is_active: checked })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => setDeleting(p)}
                            >
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No products yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Tenant config</CardTitle>
              <CardDescription>
                Brand, UI theme, feature flags, AI bot, and SEO metadata.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {configQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : configQuery.data ? (
                <TenantConfigForm
                  initialValues={normalizeConfig(configQuery.data)}
                  onSubmit={(values) => saveConfigMutation.mutate(values)}
                  isPending={saveConfigMutation.isPending}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No config found.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New product</DialogTitle>
            <DialogDescription>Add a product to this tenant catalog.</DialogDescription>
          </DialogHeader>
          <ProductForm
            onSubmit={(values) => createMutation.mutate(values)}
            onCancel={() => setCreateOpen(false)}
            isPending={createMutation.isPending}
            submitLabel="Create"
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit product</DialogTitle>
            <DialogDescription>{editing?.name}</DialogDescription>
          </DialogHeader>
          {editing && (
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
              submitLabel="Save changes"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium">{deleting?.name}</span>.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteMutation.mutate(deleting.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Generate demo confirm */}
      <AlertDialog open={demoConfirmOpen} onOpenChange={setDemoConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate demo data?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>This will create:</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    Up to <span className="font-medium">{DEMO_PRODUCT_COUNT} products</span>{" "}
                    (skipped if tenant already has them)
                  </li>
                  <li>
                    <span className="font-medium">{ordersToCreate} paid orders</span> with line
                    items
                  </li>
                  <li>
                    Funnel events from{" "}
                    <span className="font-medium">{sessionsToCreate} sessions</span> spread across
                    the last 30 days
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generateDemoMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={generateDemoMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                generateDemoMutation.mutate();
              }}
            >
              {generateDemoMutation.isPending ? "Generating…" : "Generate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear demo data confirm */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all tenant data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium">all products, orders,
              order items, and events</span> for this tenant. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearDemoMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={clearDemoMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                clearDemoMutation.mutate();
              }}
            >
              {clearDemoMutation.isPending ? "Clearing…" : "Clear everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-foreground">
          {loading ? "…" : value.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}

