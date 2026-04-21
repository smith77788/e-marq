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
import { clearDemoData } from "@/lib/demoData";
import {
  generateAcosDataset,
  ACOS_CATALOG_SIZE,
  type AcosScale,
  type AcosGenerationResult,
} from "@/lib/acosDataset";
import { TenantAnalytics } from "@/components/admin/TenantAnalytics";
import { TenantOrders } from "@/components/admin/TenantOrders";
import { AcosOverviewTab } from "@/components/admin/AcosOverviewTab";
import { AcosInsightsQueue } from "@/components/admin/AcosInsightsQueue";
import { AcosAgentRuns } from "@/components/admin/AcosAgentRuns";
import { PlanBillingTab } from "@/components/admin/PlanBillingTab";
import { BalancesTab } from "@/components/admin/BalancesTab";
import { MembersTab } from "@/components/admin/MembersTab";

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
  const [acosScale, setAcosScale] = useState<AcosScale>("medium");
  const [acosSkipExisting, setAcosSkipExisting] = useState(true);
  const [acosConfirmOpen, setAcosConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [lastAcosResult, setLastAcosResult] = useState<AcosGenerationResult | null>(null);

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
          features: { ...values.features, payments: values.payments },
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

  const generateAcosMutation = useMutation({
    mutationFn: async () => {
      const existingProducts = productsQuery.data ?? [];
      if (acosSkipExisting && existingProducts.length > 0) {
        throw new Error(
          "Tenant already has data. Disable 'Skip if data exists' or clear it first.",
        );
      }
      toast.loading("Generating ACOS dataset…", { id: "acos-gen" });
      const result = await generateAcosDataset(tenantId, acosScale, supabase);
      return result;
    },
    onSuccess: (result) => {
      setLastAcosResult(result);
      toast.success(
        `${result.products} products · ${result.customers} customers · ${result.orders} orders · ${result.events} events`,
        { id: "acos-gen", duration: 6000 },
      );
      setAcosConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["tenant-products", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-orders-count", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-events-count", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-funnel", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-revenue", tenantId] });
    },
    onError: (e: Error) => {
      toast.error(e.message, { id: "acos-gen" });
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
      queryClient.invalidateQueries({ queryKey: ["tenant-funnel", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-revenue", tenantId] });
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
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Commerce</TabsTrigger>
          <TabsTrigger value="plan">Plan & Billing</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="acos-debug">ACOS Debug</TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="space-y-4">
          <PlanBillingTab tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="balances" className="space-y-4">
          <BalancesTab tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="members" className="space-y-4">
          <MembersTab tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="acos-debug" className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Internal debug view for ACOS agents (manual queue / runs). Not part of the autonomous owner experience.
          </p>
          <AcosOverviewTab tenantId={tenantId} />
          <AcosInsightsQueue tenantId={tenantId} />
          <AcosAgentRuns tenantId={tenantId} />
        </TabsContent>

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

          <TenantAnalytics tenantId={tenantId} />


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
                ACOS-rich synthetic dataset
              </CardTitle>
              <CardDescription>
                90 days of realistic D2C signals: cohorts (new / returning / VIP-active /
                VIP-churning), weekly seasonality, product affinity, stockout-risk SKUs,
                cart-abandonment, and search-no-results events. Designed so ACOS agents can find
                real insights — not just placeholder data.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="acos-scale">Scale</Label>
                  <Select
                    value={acosScale}
                    onValueChange={(v) => setAcosScale(v as AcosScale)}
                  >
                    <SelectTrigger id="acos-scale">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Small — 120 customers</SelectItem>
                      <SelectItem value="medium">Medium — 250 customers</SelectItem>
                      <SelectItem value="large">Large — 600 customers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="acos-skip">Skip if data exists</Label>
                    <p className="text-xs text-muted-foreground">
                      Avoid duplicating data on tenants that already have a catalog.
                    </p>
                  </div>
                  <Switch
                    id="acos-skip"
                    checked={acosSkipExisting}
                    onCheckedChange={setAcosSkipExisting}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => setAcosConfirmOpen(true)}
                  disabled={generateAcosMutation.isPending}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {generateAcosMutation.isPending ? "Generating…" : "Generate ACOS dataset"}
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setClearConfirmOpen(true)}
                  disabled={clearDemoMutation.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {clearDemoMutation.isPending ? "Clearing…" : "Clear all data"}
                </Button>
              </div>

              {lastAcosResult && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="text-xs font-medium text-foreground">Last generation</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div>
                      <span className="text-muted-foreground">Products: </span>
                      <span className="font-medium text-foreground">{lastAcosResult.products}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Customers: </span>
                      <span className="font-medium text-foreground">{lastAcosResult.customers}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Orders: </span>
                      <span className="font-medium text-foreground">{lastAcosResult.orders}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Events: </span>
                      <span className="font-medium text-foreground">{lastAcosResult.events}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(lastAcosResult.cohorts).map(([cohort, count]) => (
                      <Badge key={cohort} variant="outline" className="text-[10px]">
                        {cohort.replace("_", " ")}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
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

        <TabsContent value="orders" className="space-y-4">
          <TenantOrders tenantId={tenantId} />
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

      {/* Generate ACOS dataset confirm */}
      <AlertDialog open={acosConfirmOpen} onOpenChange={setAcosConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate ACOS dataset?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>This will create a 90-day synthetic dataset with:</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <span className="font-medium">{ACOS_CATALOG_SIZE} products</span> across
                    apparel, footwear, accessories, audio (incl. 2 stockout-risk SKUs)
                  </li>
                  <li>
                    {acosScale === "small" ? "120" : acosScale === "medium" ? "250" : "600"}{" "}
                    <span className="font-medium">customers</span> across 5 cohorts
                    (new / one-time / returning / VIP-active / VIP-churning)
                  </li>
                  <li>Paid orders with realistic affinity bundles and weekly seasonality</li>
                  <li>Funnel + search events (~18% search-no-results signal)</li>
                </ul>
                <p className="text-xs text-muted-foreground">
                  Generation runs entirely client-side and may take 10-30 seconds for the larger
                  scales.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generateAcosMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={generateAcosMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                generateAcosMutation.mutate();
              }}
            >
              {generateAcosMutation.isPending ? "Generating…" : "Generate"}
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

