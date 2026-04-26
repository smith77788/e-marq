/**
 * /brand/team — керування командою бренду через посилання-запрошення.
 * Без email: створюємо одноразове посилання, яке власник може скопіювати,
 * надіслати в Telegram, або відкрити QR. Жодного SMTP, жодних мейлів.
 *
 * Збережена сумісність із RPC `create_tenant_invitation`: email генеруємо
 * автоматично як placeholder (`team-<random>@invite.local`), бо колонка
 * email NOT NULL у таблиці tenant_invitations. Реальний адресат не потрібен —
 * ідентифікація відбувається на стороні /invite/$token.
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Send, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";

type Search = { tenant?: string };

export const Route = createFileRoute("/_authenticated/brand/team")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Команда — MARQ" },
      { name: "description", content: "Запрошуйте співробітників за посиланням" },
    ],
  }),
  component: TeamPage,
});

type Invitation = {
  id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  expires_at: string;
  created_at: string;
};

type Member = {
  user_id: string;
  role: string;
  created_at: string;
  email: string | null;
  display_name: string | null;
};

function TeamPage() {
  const { tenant: urlTenant } = useSearch({ from: "/_authenticated/brand/team" });
  const { current, currentTenantId, setCurrentTenantId, tenants, loading } = useTenantContext();

  useEffect(() => {
    if (urlTenant && urlTenant !== currentTenantId) setCurrentTenantId(urlTenant);
  }, [urlTenant, currentTenantId, setCurrentTenantId]);

  const tenantId =
    urlTenant ?? currentTenantId ?? current?.tenant_id ?? tenants[0]?.tenant_id ?? null;
  const tenant = tenants.find((t) => t.tenant_id === tenantId) ?? current;
  const tenantSlug = tenant?.tenant_slug ?? "brand";
  const brandName = tenant?.tenant_name ?? "ваш бренд";

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!tenantId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Бренд не обрано</CardTitle>
          <CardDescription>Спочатку створіть або оберіть бренд.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/brand">← Назад</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/brand"
          search={{ tenant: tenantId }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Назад до {brandName}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Команда бренду</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Запрошуйте співробітників за посиланням — без пошти. Поділіться лінком у Telegram, чаті
          або месенджері. Запрошений увійде через свій акаунт і отримає доступ автоматично.
        </p>
      </div>

      <InviteCreator tenantId={tenantId} brandName={brandName} tenantSlug={tenantSlug} />
      <PendingInvitations tenantId={tenantId} brandName={brandName} />
      <ActiveMembers tenantId={tenantId} />
    </div>
  );
}

function InviteCreator({
  tenantId,
  brandName,
  tenantSlug: _tenantSlug,
}: {
  tenantId: string;
  brandName: string;
  tenantSlug: string;
}) {
  const qc = useQueryClient();
  const [role, setRole] = useState<"admin" | "viewer">("admin");
  const [lastLink, setLastLink] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      // Генеруємо унікальний placeholder-email (RPC вимагає унікальність на (tenant, email))
      const placeholder = `team-${crypto.randomUUID().slice(0, 8)}@invite.local`;
      const { data, error } = await supabase.rpc("create_tenant_invitation", {
        _tenant_id: tenantId,
        _email: placeholder,
        _role: role,
      });
      if (error) throw error;
      return data as { token: string; email: string };
    },
    onSuccess: async (res) => {
      const url = `${window.location.origin}/invite/${res.token}`;
      setLastLink(url);
      qc.invalidateQueries({ queryKey: ["team-invitations", tenantId] });
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Посилання створено й скопійовано в буфер");
      } catch {
        toast.success("Посилання створено");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersRound className="h-4 w-4 text-primary" />
          Створити посилання-запрошення
        </CardTitle>
        <CardDescription>
          Одне натискання — і ви маєте посилання, дійсне 14 днів. Надішліть його колезі будь-яким
          месенджером.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="text-sm text-muted-foreground">Роль:</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRole("admin")}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                role === "admin"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              <ShieldCheck className="mr-1 inline h-3 w-3" />
              Адміністратор
            </button>
            <button
              type="button"
              onClick={() => setRole("viewer")}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                role === "viewer"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              Перегляд
            </button>
          </div>
        </div>

        <Button
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="w-full sm:w-auto"
        >
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Згенерувати посилання
        </Button>

        {lastLink && (
          <div className="space-y-2 rounded-md border border-success/30 bg-success/5 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-success">
              <Check className="h-3.5 w-3.5" />
              Посилання готове
            </div>
            <div className="flex gap-2">
              <Input readOnly value={lastLink} className="h-8 font-mono text-xs" />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => {
                  navigator.clipboard.writeText(lastLink).then(() => toast.success("Скопійовано"));
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" asChild>
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(lastLink)}&text=${encodeURIComponent(
                    `Запрошую тебе долучитися до команди «${brandName}» в MARQ`,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Send className="mr-1 h-3.5 w-3.5" />
                  Надіслати в Telegram
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(
                    `Запрошую тебе долучитися до команди «${brandName}» в MARQ: ${lastLink}`,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Поділитись у WhatsApp
                </a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingInvitations({ tenantId, brandName }: { tenantId: string; brandName: string }) {
  const qc = useQueryClient();
  const { data: invites = [], isLoading } = useQuery<Invitation[]>({
    queryKey: ["team-invitations", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_invitations")
        .select("id, email, role, token, status, expires_at, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Invitation[];
    },
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tenant_invitations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Запрошення скасовано");
      qc.invalidateQueries({ queryKey: ["team-invitations", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = useMemo(() => invites.filter((i) => i.status === "pending"), [invites]);

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (pending.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Активні посилання · {pending.length}</CardTitle>
        <CardDescription>Поки не використані. Можна скасувати у будь-який момент.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {pending.map((inv) => {
            const url = `${window.location.origin}/invite/${inv.token}`;
            const expiresIn = Math.max(
              0,
              Math.round((new Date(inv.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
            );
            return (
              <li
                key={inv.id}
                className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {inv.role}
                  </Badge>
                  <span className="text-xs text-muted-foreground">діє ще {expiresIn} дн.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 px-2 text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm("Скасувати це посилання?")) revoke.mutate(inv.id);
                    }}
                    disabled={revoke.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input readOnly value={url} className="h-7 font-mono text-[10px]" />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2"
                    onClick={() => {
                      navigator.clipboard.writeText(url).then(() => toast.success("Скопійовано"));
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="secondary" className="h-7 px-2" asChild>
                    <a
                      href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(
                        `Запрошення до команди «${brandName}»`,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Send className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function ActiveMembers({ tenantId }: { tenantId: string }) {
  const { data: members = [], isLoading } = useQuery<Member[]>({
    queryKey: ["team-members", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_memberships")
        .select("user_id, role, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((m) => ({
        ...m,
        email: null,
        display_name: null,
      })) as Member[];
    },
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Поточна команда · {members.length}</CardTitle>
        <CardDescription>Учасники, які вже мають доступ до бренду.</CardDescription>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Поки що ви єдиний учасник.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {members.map((m) => (
              <li
                key={m.user_id}
                className="flex items-center justify-between rounded-md border border-border bg-muted/10 px-3 py-2"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {m.user_id.slice(0, 8)}…
                </span>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {m.role}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
