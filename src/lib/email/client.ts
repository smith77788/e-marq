/**
 * Клієнт-сайд helpers для виклику email server routes.
 *
 * Тримати їх дуже тонкими: основна логіка — на сервері.
 */
import { supabase } from "@/integrations/supabase/client";

export async function sendOrderConfirmationEmail(orderId: string): Promise<void> {
  try {
    const res = await fetch("/api/email/order-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[email] confirmation failed:", res.status, text.slice(0, 200));
    }
  } catch (e) {
    console.warn("[email] confirmation network error:", e);
  }
}

export async function sendOrderStatusEmail(
  orderId: string,
  newStatus: "paid" | "fulfilled" | "cancelled" | "refunded",
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      console.warn("[email] status update skipped: no session");
      return;
    }
    const res = await fetch("/api/email/order-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ orderId, newStatus }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[email] status update failed:", res.status, text.slice(0, 200));
    }
  } catch (e) {
    console.warn("[email] status update network error:", e);
  }
}
