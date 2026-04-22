import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  Building2,
  Camera,
  Crown,
  KeyRound,
  Languages,
  Loader2,
  LogOut,
  Save,
  Shield,
  Sun,
  UserRound,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PlanBadge } from "@/components/admin/PlanBadge";
import { UsageMeters, type PlanSummary } from "@/components/admin/UsageMeters";
import { OwnerPlanSwitcher } from "@/components/owner/OwnerPlanSwitcher";
import { MfaSetupCard } from "@/components/owner/MfaSetupCard";
import { useAuth } from "@/hooks/useAuth";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

const SUB_STATUS_LABEL: Record<string, string> = {
  trial: "пробний період",
  active: "активний",
  past_due: "прострочено",
  suspended: "призупинено",
  cancelled: "скасовано",
};

type UserPrefs = {
  user_id: string;
  locale: "ua" | "en";
  theme: "system" | "light" | "dark";
  email_notifications: boolean;
  telegram_notifications: boolean;
  marketing_opt_in: boolean;
};

function initials(email?: string | null, name?: string | null) {
  const src = (name?.trim() || email || "U").trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
}

function ProfilePage() {
  const { user, updateProfile, updatePassword, signOut } = useAuth();
  const { current, currentTenantId, tenants } = useTenantContext();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const meta = (user?.user_metadata ?? {}) as Record<string, string | undefined>;
  const [fullName, setFullName] = useState(meta.full_name ?? "");
  const [bio, setBio] = useState(meta.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(meta.avatar_url ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const tenantId = currentTenantId ?? current?.tenant_id;
  const canManagePlan =
    current?.membership_role === "owner" || current?.membership_role === "admin";

  // Plan summary
  const summaryQuery = useQuery({
    queryKey: ["plan-summary", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_tenant_plan_summary", {
        _tenant_id: tenantId!,
      });
      if (error) throw error;
      return data as PlanSummary | null;
    },
  });

  // Preferences
  const prefsQuery = useQuery({
    queryKey: ["user-prefs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (
        (data as UserPrefs | null) ?? {
          user_id: user!.id,
          locale: "ua",
          theme: "system",
          email_notifications: true,
          telegram_notifications: true,
          marketing_opt_in: false,
        }
      );
    },
  });

  const prefsMut = useMutation({
    mutationFn: async (next: Partial<UserPrefs>) => {
      if (!user) throw new Error("not authenticated");
      const payload = { ...prefsQuery.data, ...next, user_id: user.id };
      const { error } = await supabase
        .from("user_preferences")
        .upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Налаштування збережено");
      qc.invalidateQueries({ queryKey: ["user-prefs", user?.id] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Помилка збереження"),
  });

  useEffect(() => {
    setFullName(meta.full_name ?? "");
    setBio(meta.bio ?? "");
    setAvatarUrl(meta.avatar_url ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function handleSaveProfile() {
    try {
      setSavingProfile(true);
      await updateProfile({ fullName, bio });
      // also persist avatar_url via auth metadata
      if (avatarUrl !== (meta.avatar_url ?? "")) {
        const { error } = await supabase.auth.updateUser({ data: { avatar_url: avatarUrl } });
        if (error) throw error;
      }
      toast.success("Профіль оновлено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не вдалося оновити профіль");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAvatarUpload(file: File) {
    if (!user) return;
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Файл завеликий — максимум 4MB");
      return;
    }
    try {
      setUploadingAvatar(true);
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
      const { error } = await supabase.auth.updateUser({ data: { avatar_url: data.publicUrl } });
      if (error) throw error;
      toast.success("Аватар оновлено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не вдалося завантажити аватар");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleChangePassword() {
    if (newPassword.length < 8) {
      toast.error("Пароль має містити щонайменше 8 символів");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Паролі не співпадають");
      return;
    }
    try {
      setSavingPassword(true);
      await updatePassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Пароль змінено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Помилка зміни пароля");
    } finally {
      setSavingPassword(false);
    }
  }

  const prefs = prefsQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-14 w-14 ring-2 ring-primary/30">
            <AvatarImage src={avatarUrl} alt={fullName || user?.email || "avatar"} />
            <AvatarFallback className="bg-gradient-primary text-primary-foreground">
              {initials(user?.email, fullName)}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{fullName || "Мій профіль"}</h1>
            <p className="text-sm text-muted-foreground">{user?.email ?? "—"}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          <LogOut className="mr-1.5 h-3.5 w-3.5" /> Вийти з акаунта
        </Button>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="flex w-full max-w-3xl flex-wrap">
          <TabsTrigger value="general" className="gap-1.5"><UserRound className="h-3.5 w-3.5" /> Загальне</TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5"><Shield className="h-3.5 w-3.5" /> Безпека</TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5"><Bell className="h-3.5 w-3.5" /> Сповіщення</TabsTrigger>
          <TabsTrigger value="brands" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Бренди</TabsTrigger>
          <TabsTrigger value="billing" className="gap-1.5"><Crown className="h-3.5 w-3.5" /> Тариф</TabsTrigger>
        </TabsList>

        {/* GENERAL */}
        <TabsContent value="general" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-primary" /> Дані акаунта
              </CardTitle>
              <CardDescription>Email входу: {user?.email ?? "—"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16 ring-2 ring-primary/30">
                  <AvatarImage src={avatarUrl} alt="avatar" />
                  <AvatarFallback className="bg-gradient-primary text-primary-foreground">
                    {initials(user?.email, fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleAvatarUpload(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploadingAvatar}
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Camera className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Змінити аватар
                  </Button>
                  <p className="text-xs text-muted-foreground">PNG/JPG до 4MB</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="full-name">Імʼя</Label>
                <Input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ваше імʼя" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">Про себе</Label>
                <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Короткий опис" className="min-h-28" />
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveProfile} disabled={savingProfile}>
                  {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Зберегти
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Languages className="h-4 w-4 text-info" /> Інтерфейс</CardTitle>
              <CardDescription>Мова і тема відображення.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Мова</Label>
                <Select
                  value={prefs?.locale ?? "ua"}
                  onValueChange={(v) => prefsMut.mutate({ locale: v as "ua" | "en" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ua">Українська</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" /> Тема</Label>
                <Select
                  value={prefs?.theme ?? "system"}
                  onValueChange={(v) => prefsMut.mutate({ theme: v as "system" | "light" | "dark" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">Системна</SelectItem>
                    <SelectItem value="dark">Темна (cockpit)</SelectItem>
                    <SelectItem value="light">Світла</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SECURITY */}
        <TabsContent value="security" className="mt-4 space-y-4">
          <MfaSetupCard />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-warning" /> Зміна пароля</CardTitle>
              <CardDescription>Мінімум 8 символів. Після зміни ви залишаєтеся в системі.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="new-pw">Новий пароль</Label>
                <Input id="new-pw" type="password" autoComplete="new-password"
                  value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-pw2">Підтвердіть пароль</Label>
                <Input id="new-pw2" type="password" autoComplete="new-password"
                  value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
              <div className="flex justify-end">
                <Button onClick={handleChangePassword} disabled={savingPassword}>
                  {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Змінити пароль
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <Shield className="h-4 w-4" /> Небезпечна зона
              </CardTitle>
              <CardDescription>
                Видалення акаунта незворотне. Дані бренду залишаться, доступ — буде втрачено.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">Видалити мій акаунт</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Видалити акаунт?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Зверніться до супер-адміністратора — він обробить запит протягом 24 год.
                      Це обмеження зроблено навмисно, щоб запобігти випадковим видаленням.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Скасувати</AlertDialogCancel>
                    <AlertDialogAction onClick={() => toast.info("Запит зафіксовано. Звʼяжемось.")}>
                      Підтвердити запит
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </TabsContent>

        {/* NOTIFICATIONS */}
        <TabsContent value="notifications" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bell className="h-4 w-4 text-accent" /> Канали сповіщень</CardTitle>
              <CardDescription>Як отримувати алерти від агентів та системи.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                title="Email-сповіщення"
                desc="Щоденні дайджести, критичні інсайти, рахунки."
                checked={prefs?.email_notifications ?? true}
                onChange={(v) => prefsMut.mutate({ email_notifications: v })}
              />
              <ToggleRow
                title="Telegram-сповіщення"
                desc="Миттєві алерти власнику бренду через бота."
                checked={prefs?.telegram_notifications ?? true}
                onChange={(v) => prefsMut.mutate({ telegram_notifications: v })}
              />
              <ToggleRow
                title="Маркетингові розсилки"
                desc="Новини MARQ, апдейти, кейси."
                checked={prefs?.marketing_opt_in ?? false}
                onChange={(v) => prefsMut.mutate({ marketing_opt_in: v })}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* BRANDS */}
        <TabsContent value="brands" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> Мої бренди</CardTitle>
              <CardDescription>Бренди, де ви маєте доступ.</CardDescription>
            </CardHeader>
            <CardContent>
              {tenants.length === 0 ? (
                <p className="text-sm text-muted-foreground">У вас ще немає брендів.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {tenants.map((t) => (
                    <li key={t.tenant_id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium">{t.tenant_name}</p>
                        <p className="text-xs text-muted-foreground">/{t.tenant_slug} · {t.membership_role}</p>
                      </div>
                      <Badge variant="outline">{t.plan_name}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* BILLING */}
        <TabsContent value="billing" className="mt-4 space-y-4">
          {tenantId ? (
            summaryQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Завантажую тариф…</p>
            ) : summaryQuery.data ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      <Crown className="h-4 w-4 text-warning" />
                      Підписка бренду {current?.tenant_name ? `· ${current.tenant_name}` : ""}
                      <PlanBadge planKey={summaryQuery.data.plan.key} planName={summaryQuery.data.plan.name} />
                    </CardTitle>
                    <CardDescription>
                      Статус: {SUB_STATUS_LABEL[summaryQuery.data.subscription.status] ?? summaryQuery.data.subscription.status} ·
                      Період {new Date(summaryQuery.data.subscription.current_period_start).toLocaleDateString("uk-UA")}
                      {" → "}
                      {new Date(summaryQuery.data.subscription.current_period_end).toLocaleDateString("uk-UA")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <UsageMeters summary={summaryQuery.data} compact />
                  </CardContent>
                </Card>

                {canManagePlan ? (
                  <OwnerPlanSwitcher tenantId={tenantId} currentPlanKey={summaryQuery.data.plan.key} />
                ) : (
                  <Card>
                    <CardContent className="pt-6 text-sm text-muted-foreground">
                      Лише власник або адміністратор бренду може змінювати тарифний план.
                    </CardContent>
                  </Card>
                )}
              </>
            ) : null
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Тарифний план</CardTitle>
                <CardDescription>
                  Підключи або обери бренд, щоб керувати його підпискою зі свого профілю.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ToggleRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
