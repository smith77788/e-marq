/**
 * Діалог для постановки ручної MTProto-дії (DM) у чергу від імені власника.
 * Викликається з рядка проспекта в Lead Radar.
 */
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  tenantId: string | null;
  prospectId: string;
  prospectName: string;
  defaultPeer?: string;
  defaultText?: string;
  trigger?: React.ReactNode;
};

export function TelegramUserDmDialog({
  tenantId,
  prospectId,
  prospectName,
  defaultPeer = "",
  defaultText = "",
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const [peer, setPeer] = useState(defaultPeer);
  const [text, setText] = useState(defaultText);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!tenantId) {
      toast.error("Спочатку оберіть бренд");
      return;
    }
    const peerTrim = peer.trim();
    const textTrim = text.trim();
    if (!peerTrim) {
      toast.error("Вкажіть @username або chat_id");
      return;
    }
    if (!textTrim) {
      toast.error("Текст повідомлення не може бути порожнім");
      return;
    }
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Авторизуйтеся");
      const r = await fetch("/api/telegram/user/queue-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          prospect_id: prospectId,
          action_type: "send_dm",
          peer: peerTrim,
          text: textTrim,
        }),
      });
      const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        const code = String(json.error ?? `HTTP ${r.status}`);
        if (code === "no_active_session") {
          throw new Error("Спочатку підключіть особистий Telegram-акаунт");
        }
        throw new Error(code);
      }
      toast.success("DM поставлено в чергу", {
        description: "Виконавець відправить його з вашого акаунта з людською затримкою.",
      });
      setOpen(false);
      setText("");
    } catch (e) {
      toast.error("Не вдалося поставити в чергу", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span onClick={() => setOpen(true)} className="contents">
        {trigger ?? (
          <Button size="sm" variant="ghost" disabled={!tenantId}>
            <Send className="mr-1 h-3.5 w-3.5" />
            DM в Telegram
          </Button>
        )}
      </span>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Особистий DM у Telegram</DialogTitle>
          <DialogDescription>
            Повідомлення піде з вашого підключеного акаунта до <b>{prospectName}</b>. Виконавець
            дотримується денних/годинних квот та людиноподібних затримок.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tg-peer" className="text-xs">
              Кому (@username або chat_id)
            </Label>
            <Input
              id="tg-peer"
              value={peer}
              onChange={(e) => setPeer(e.target.value)}
              placeholder="@brand_owner"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tg-text" className="text-xs">
              Текст
            </Label>
            <Textarea
              id="tg-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Привіт! Бачив ваш бренд та подумав, що MARQ може бути корисним…"
              rows={5}
              disabled={busy}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Скасувати
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            Поставити в чергу
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
