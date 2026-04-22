import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/page-skeleton";
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

const COHORT_LABEL: Record<string, string> = {
  new: "нові",
  one_time: "разові",
  returning: "постійні",
  vip_active: "найцінніші активні",
  vip_churning: "найцінніші, можуть піти",
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
      toast.success("Товар створено");
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
      toast.success("Товар оновлено");
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
      toast.success("Товар видалено");
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
      toast.success("Налаштування збережено");
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
      toast.loading("Готуємо демо-дані для ACOS…", { id: "acos-gen" });
      const result = await generateAcosDataset(tenantId, acosScale, supabase);
      return result;
    },
    onSuccess: (result) => {
      setLastAcosResult(result);
      toast.success(
        `Готово · товарів: ${result.products} · клієнтів: ${result.customers} · замовлень: ${result.orders} · подій: ${result.events}`,
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
      toast.success("Готово · демо-дані видалено");
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
    return <PageSkeleton blocks={4} />;
  }

  if (!isSuperAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Доступ заборонено</CardTitle>
          <CardDescription>Ця сторінка лише для супер-адміністраторів.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (tenantQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Завантажую бренд…</p>;
  }

  if (tenantQuery.error || !tenantQuery.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Бренд не знайдено</CardTitle>
          <CardDescription>Цей бренд не існує або у вас немає доступу.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/admin/tenants" className="text-sm font-medium text-primary hover:underline">
            ← Назад до брендів
          </Link>
        </CardContent>
      </Card>
    );
  }

  const tenant = tenantQuery.data;
  const T_STATUS: Record<string, string> = {
    active: "активний",
    suspended: "призупинено",
    inactive: "вимкнено",
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/tenants"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          ← Бренди
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{tenant.name}</h1>
          <Badge variant={tenant.status === "active" ? "default" : "outline"}>
            {T_STATUS[tenant.status] ?? tenant.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">/{tenant.slug}</p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Огляд</TabsTrigger>
          <TabsTrigger value="plan">Тариф</TabsTrigger>
          <TabsTrigger value="members">Команда</TabsTrigger>
          <TabsTrigger value="products">Товари</TabsTrigger>
          <TabsTrigger value="orders">Замовлення</TabsTrigger>
          <TabsTrigger value="config">Налаштування</TabsTrigger>
          <TabsTrigger value="acos-debug">ШІ-помічники (тех)</TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="space-y-4">
          <PlanBillingTab tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="members" className="space-y-4">
          <MembersTab tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="acos-debug" className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Технічна панель для відлагодження роботи агентів. Не використовується власниками брендів
            у звичайному режимі.
          </p>
          <AcosOverviewTab tenantId={tenantId} />
          <AcosInsightsQueue tenantId={tenantId} />
          <AcosAgentRuns tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Товарів"
              value={productsQuery.data?.length ?? 0}
              loading={productsQuery.isLoading}
            />
            <StatCard
              label="Замовлень"
              value={ordersQuery.data ?? 0}
              loading={ordersQuery.isLoading}
            />
            <StatCard label="Подій" value={eventsQuery.data ?? 0} loading={eventsQuery.isLoading} />
          </div>

          <TenantAnalytics tenantId={tenantId} />

          <Card>
            <CardHeader>
              <CardTitle>Технічна інформація</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">ID бренду</dt>
                <dd className="font-mono text-xs text-foreground">{tenant.id}</dd>
                <dt className="text-muted-foreground">ID власника</dt>
                <dd className="font-mono text-xs text-foreground">{tenant.owner_user_id}</dd>
                <dt className="text-muted-foreground">Створено</dt>
                <dd className="text-foreground">
                  {new Date(tenant.created_at).toLocaleString("uk-UA")}
                </dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Демо-дані для тестування ШІ-помічників
              </CardTitle>
              <CardDescription>
                Реалістичний набір даних за 90 днів: групи клієнтів (нові, постійні, найцінніші
                активні та такі, що можуть піти), сезонність по тижнях, набори товарів, що часто
                купують разом, ризики закінчення на складі, покинуті кошики та пошук без
                результатів. Створено для того, щоб ШІ-помічники могли знаходити справжні підказки.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="acos-scale">Розмір набору</Label>
                  <Select value={acosScale} onValueChange={(v) => setAcosScale(v as AcosScale)}>
                    <SelectTrigger id="acos-scale">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Малий — 120 клієнтів</SelectItem>
                      <SelectItem value="medium">Середній — 250 клієнтів</SelectItem>
                      <SelectItem value="large">Великий — 600 клієнтів</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="acos-skip">Пропустити, якщо дані вже є</Label>
                    <p className="text-xs text-muted-foreground">
                      Не створювати дублі для брендів, у яких уже є каталог.
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
                  {generateAcosMutation.isPending ? "Створюємо…" : "Створити демо-набір даних"}
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setClearConfirmOpen(true)}
                  disabled={clearDemoMutation.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {clearDemoMutation.isPending ? "Очищаємо…" : "Очистити всі дані"}
                </Button>
              </div>

              {lastAcosResult && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="text-xs font-medium text-foreground">Останнє створення</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div>
                      <span className="text-muted-foreground">Товарів: </span>
                      <span className="font-medium text-foreground">{lastAcosResult.products}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Клієнтів: </span>
                      <span className="font-medium text-foreground">
                        {lastAcosResult.customers}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Замовлень: </span>
                      <span className="font-medium text-foreground">{lastAcosResult.orders}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Подій: </span>
                      <span className="font-medium text-foreground">{lastAcosResult.events}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(lastAcosResult.cohorts).map(([cohort, count]) => (
                      <Badge key={cohort} variant="outline" className="text-[10px]">
                        {COHORT_LABEL[cohort] ?? cohort.replace("_", " ")}: {count}
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
                <CardTitle>Товари</CardTitle>
                <CardDescription>
                  Усього: {productsQuery.data?.length ?? 0}. Керуйте каталогом цього бренду.
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                + Новий товар
              </Button>
            </CardHeader>
            <CardContent>
              {productsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Завантажуємо…</p>
              ) : productsQuery.data && productsQuery.data.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Назва</TableHead>
                        <TableHead>Артикул</TableHead>
                        <TableHead className="text-right">Ціна</TableHead>
                        <TableHead className="text-right">Залишок</TableHead>
                        <TableHead>Активний</TableHead>
                        <TableHead className="text-right">Дії</TableHead>
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
                                Редагувати
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setDeleting(p)}
                              >
                                Видалити
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Поки що товарів немає.</p>
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
              <CardTitle>Налаштування бренду</CardTitle>
              <CardDescription>
                Назва, оформлення, увімкнені можливості, ШІ-помічник та SEO.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {configQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Завантажуємо…</p>
              ) : configQuery.data ? (
                <TenantConfigForm
                  initialValues={normalizeConfig(configQuery.data)}
                  onSubmit={(values) => saveConfigMutation.mutate(values)}
                  isPending={saveConfigMutation.isPending}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Налаштування не знайдено.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Створення товару */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новий товар</DialogTitle>
            <DialogDescription>Додайте товар у каталог цього бренду.</DialogDescription>
          </DialogHeader>
          <ProductForm
            onSubmit={(values) => createMutation.mutate(values)}
            onCancel={() => setCreateOpen(false)}
            isPending={createMutation.isPending}
            submitLabel="Створити"
          />
        </DialogContent>
      </Dialog>

      {/* Редагування товару */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редагування товару</DialogTitle>
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
              submitLabel="Зберегти зміни"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Підтвердження видалення */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Видалити товар?</AlertDialogTitle>
            <AlertDialogDescription>
              Товар <span className="font-medium">{deleting?.name}</span> буде видалено назавжди. Цю
              дію не можна скасувати.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Скасувати</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteMutation.mutate(deleting.id);
              }}
            >
              {deleteMutation.isPending ? "Видаляємо…" : "Так, видалити"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Підтвердження генерації демо ACOS */}
      <AlertDialog open={acosConfirmOpen} onOpenChange={setAcosConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Створити демо-набір даних для ACOS?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Буде створено реалістичний набір даних за останні 90 днів:</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <span className="font-medium">{ACOS_CATALOG_SIZE} товарів</span> — одяг, взуття,
                    аксесуари та аудіо (зокрема 2 з ризиком закінчитись на складі)
                  </li>
                  <li>
                    <span className="font-medium">
                      {acosScale === "small" ? "120" : acosScale === "medium" ? "250" : "600"}{" "}
                      клієнтів
                    </span>{" "}
                    із 5 типових груп (нові, разові, постійні, найцінніші активні та найцінніші, що
                    можуть піти)
                  </li>
                  <li>Оплачені замовлення з реалістичними наборами товарів та сезонністю</li>
                  <li>Події шляху покупця та пошуку (приблизно 18% — пошук без результатів)</li>
                </ul>
                <p className="text-xs text-muted-foreground">
                  Дані створюються прямо у браузері — для більших обʼємів це може зайняти 10–30
                  секунд.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generateAcosMutation.isPending}>
              Скасувати
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={generateAcosMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                generateAcosMutation.mutate();
              }}
            >
              {generateAcosMutation.isPending ? "Створюємо…" : "Створити дані"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Підтвердження очищення демо-даних */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Очистити всі дані бренду?</AlertDialogTitle>
            <AlertDialogDescription>
              Буде назавжди видалено{" "}
              <span className="font-medium">
                всі товари, замовлення, позиції замовлень та події
              </span>{" "}
              цього бренду. Цю дію не можна скасувати.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearDemoMutation.isPending}>Скасувати</AlertDialogCancel>
            <AlertDialogAction
              disabled={clearDemoMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                clearDemoMutation.mutate();
              }}
            >
              {clearDemoMutation.isPending ? "Очищаємо…" : "Так, очистити все"}
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
