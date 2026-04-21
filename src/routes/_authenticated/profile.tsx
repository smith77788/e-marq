import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, UserRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const [fullName, setFullName] = useState((user?.user_metadata?.full_name as string | undefined) ?? "");
  const [bio, setBio] = useState((user?.user_metadata?.bio as string | undefined) ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    try {
      setSaving(true);
      await updateProfile({ fullName, bio });
      toast.success("Профіль оновлено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не вдалось оновити профіль");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Мій профіль</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Тут можна змінити власні дані акаунта, які бачиш у робочому просторі.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-muted-foreground" />
            Дані акаунта
          </CardTitle>
          <CardDescription>
            Email входу: {user?.email ?? "—"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full-name">Імʼя</Label>
            <Input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ваше імʼя" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Про себе</Label>
            <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Короткий опис" className="min-h-28" />
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Зберегти
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}