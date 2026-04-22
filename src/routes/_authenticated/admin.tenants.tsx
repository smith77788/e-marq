import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/admin/tenants")({
  component: AdminTenantsPage,
});

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function AdminTenantsPage() {
  const { isSuperAdmin, loading, user } = useAuth();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const tenantsQuery = useQuery({
    queryKey: ["admin-tenants"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, status, owner_user_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createTenant = useMutation({
    mutationFn: async (input: { name: string; slug: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("tenants")
        .insert({
          name: input.name,
          slug: input.slug,
          owner_user_id: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Бренд створено");
      setName("");
      setSlug("");
      setSlugTouched(false);
      void qc.invalidateQueries({ queryKey: ["admin-tenants"] });
      void qc.invalidateQueries({ queryKey: ["my-tenants"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Не вдалося створити бренд");
    },
  });

  if (loading) {
    return <p className="text-sm text-muted-foreground">Завантаження…</p>;
  }

  if (!isSuperAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Доступ заборонено</CardTitle>
          <CardDescription>Ця сторінка лише для супер-адміністраторів.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/dashboard" className="text-sm font-medium text-primary hover:underline">
            ← На головну
          </Link>
        </CardContent>
      </Card>
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const finalSlug = (slug || slugify(name)).trim();
    if (!name.trim() || !finalSlug) {
      toast.error("Назва та коротке імʼя обовʼязкові");
      return;
    }
    createTenant.mutate({ name: name.trim(), slug: finalSlug });
  }

  const STATUS_LABEL: Record<string, string> = {
    active: "активний",
    suspended: "призупинено",
    inactive: "вимкнено",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Бренди</h1>
        <p className="text-sm text-muted-foreground">
          Створення та керування всіма робочими просторами брендів.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Створити бренд</CardTitle>
          <CardDescription>
            Власником стаєте ви. Базові налаштування створюються автоматично.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="name">Назва бренду</Label>
              <Input
                id="name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="Acme Coffee"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Коротке імʼя в адресі</Label>
              <Input
                id="slug"
                required
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                placeholder="acme-coffee"
              />
            </div>
            <Button type="submit" disabled={createTenant.isPending}>
              {createTenant.isPending ? "Створюю…" : "Створити"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Усі бренди</CardTitle>
          <CardDescription>Усього: {tenantsQuery.data?.length ?? 0}</CardDescription>
        </CardHeader>
        <CardContent>
          {tenantsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Завантаження…</p>
          ) : tenantsQuery.data && tenantsQuery.data.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Назва</TableHead>
                    <TableHead>Адреса</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Створено</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenantsQuery.data.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        <Link
                          to="/admin/tenants/$tenantId"
                          params={{ tenantId: t.id }}
                          className="hover:underline"
                        >
                          {t.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">/{t.slug}</TableCell>
                      <TableCell>
                        <Badge variant={t.status === "active" ? "default" : "outline"}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(t.created_at).toLocaleDateString("uk-UA")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Поки що брендів немає. Створіть перший вище.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
