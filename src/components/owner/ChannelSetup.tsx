import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

type Props = { tenantId: string; tenantSlug: string };

type BotConfig = { telegram?: { bot_token?: string; bot_username?: string } };

export function ChannelSetup({ tenantId, tenantSlug }: Props) {
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [registering, setRegistering] = useState(false);

  const { data: cfg } = useQuery({
    queryKey: ["tenant-bot", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase
        .from("tenant_configs")
        .select("bot")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      return (data?.bot as BotConfig) ?? {};
    },
  });

  const existingToken = cfg?.telegram?.bot_token;
  const existingUsername = cfg?.telegram?.bot_username;

  const save = useMutation({
    mutationFn: async () => {
      const next = {
        ...(cfg ?? {}),
        telegram: {
          ...(cfg?.telegram ?? {}),
          bot_token: token || existingToken || "",
          bot_username: botUsername || existingUsername || "",
        },
      };
      const { error } = await supabase
        .from("tenant_configs")
        .update({ bot: next as never })
        .eq("tenant_id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Telegram bot saved");
      setToken("");
      setBotUsername("");
      qc.invalidateQueries({ queryKey: ["tenant-bot", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function registerWebhook() {
    const t = token || existingToken;
    if (!t) return toast.error("Save bot token first");
    setRegistering(true);
    try {
      const url = `${window.location.origin}/hooks/telegram/webhook/${tenantSlug}`;
      const res = await fetch(`https://api.telegram.org/bot${t}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, allowed_updates: ["message"] }),
      });
      const json = (await res.json()) as { ok?: boolean; description?: string };
      if (!json.ok) throw new Error(json.description ?? "Telegram rejected webhook");
      toast.success(`Webhook registered → ${url}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRegistering(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary" />
          Telegram channel
        </CardTitle>
        <CardDescription>
          Once connected, the system will message your customers directly on Telegram. No human in the loop.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {existingToken && (
          <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-2 text-xs text-success">
            <CheckCircle2 className="h-4 w-4" />
            Bot token configured{existingUsername ? ` (@${existingUsername})` : ""}
          </div>
        )}

        <ol className="list-inside list-decimal space-y-2 text-xs text-muted-foreground">
          <li>
            Open <a className="font-medium text-primary underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather <ExternalLink className="inline h-3 w-3" /></a> and create a new bot with <code>/newbot</code>.
          </li>
          <li>Copy the HTTP API token BotFather gives you.</li>
          <li>Paste it below and save.</li>
          <li>Click "Register webhook" — done.</li>
        </ol>

        <div className="space-y-2">
          <Label htmlFor="bot-token">Bot HTTP API token</Label>
          <Input
            id="bot-token"
            type="password"
            placeholder={existingToken ? "•••••••• (already saved — paste to overwrite)" : "123456:ABC-DEF..."}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bot-username">Bot username (optional, without @)</Label>
          <Input
            id="bot-username"
            placeholder={existingUsername ?? "AcmeShopBot"}
            value={botUsername}
            onChange={(e) => setBotUsername(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending || (!token && !botUsername)}>
            {save.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
          <Button variant="outline" onClick={registerWebhook} disabled={registering || !(token || existingToken)}>
            {registering && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Register webhook
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
