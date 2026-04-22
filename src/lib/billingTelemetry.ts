/**
 * Лёгкий клієнтський трекер подій сторінки білінгу.
 *
 * - Пише події у таблицю `events` (тип "content_viewed" з payload.kind),
 *   щоб аналітичні агенти могли підняти їх з продакшен-логів.
 * - Тримає лічильник «провалів навігації» / швидких відскоків у sessionStorage:
 *     якщо за хвилину >=3 невдалих переходів на /brand/billing — стріляє
 *     одноразовий toast-алерт «навігаційні збої».
 *
 * Все на клієнті, без бекенда — це первинна сигналізація. Серверні алерти
 * робить окремий агент anomaly-detector над таблицею events.
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type BillingEvent =
  | "billing.cta_click" //  «Оплата та баланс» click
  | "billing.page_view" //  /brand/billing відкрито
  | "billing.page_bounce" //  закрив швидко (<2с)
  | "billing.nav_failed"; //  не вдалось завантажити

const SS_KEY = "marq.billingNavFailures";
const ALERT_FLAG = "marq.billingNavFailureAlert";
const WINDOW_MS = 60_000;
const SPIKE_THRESHOLD = 3;

export function trackBilling(
  tenantId: string,
  kind: BillingEvent,
  payload: Record<string, unknown> = {},
) {
  // 1) Пишемо подію (best-effort, без await — не блокуємо UI)
  void supabase
    .from("events")
    .insert({
      tenant_id: tenantId,
      type: "content_viewed",
      payload: {
        ts: new Date().toISOString(),
        kind,
        path: typeof window !== "undefined" ? window.location.pathname : null,
        ...payload,
      },
    })
    .then(({ error }) => {
      if (error) {
        // не показуємо користувачу — це фонова телеметрія
        console.warn("[billing-telemetry]", error.message);
      }
    });

  // 2) Локальна сигналізація про спайк навігаційних збоїв
  if (kind === "billing.nav_failed") {
    bumpFailureCounterAndMaybeAlert();
  }
}

function bumpFailureCounterAndMaybeAlert() {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const raw = window.sessionStorage.getItem(SS_KEY);
    const parsed: number[] = raw ? JSON.parse(raw) : [];
    const recent = parsed.filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    window.sessionStorage.setItem(SS_KEY, JSON.stringify(recent));

    if (recent.length >= SPIKE_THRESHOLD && !window.sessionStorage.getItem(ALERT_FLAG)) {
      window.sessionStorage.setItem(ALERT_FLAG, "1");
      toast.warning("Сторінка оплати поводиться нестабільно", {
        description:
          "Кілька спроб поспіль не вдалися. Ми вже отримали сигнал — спробуйте ще раз або напишіть менеджеру.",
        duration: 8000,
      });
    }
  } catch {
    /* ignore quota/JSON errors */
  }
}
