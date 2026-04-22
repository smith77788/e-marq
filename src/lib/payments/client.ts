/**
 * Client-side helpers для запуску UA шлюзів після створення замовлення.
 *
 * Кожен метод викликає відповідний /api/public/payments/<provider>-init,
 * отримує дані для редіректу або self-submit форми, і:
 *  - LiqPay   — створює <form method=POST action=...> з data+signature та сабмітить
 *  - WayForPay— створює <form method=POST action=...> з усіма полями та сабмітить
 *  - Monobank — робить window.location.assign(redirectUrl)
 *
 * Якщо init повернув помилку — кидаємо Error із машинно-читаним кодом.
 */

export type PaymentMethod = "manual" | "liqpay" | "wayforpay" | "monobank";

type InitResponse =
  | {
      ok: true;
      provider: "liqpay";
      action: string;
      formFields: { data: string; signature: string };
      intentId?: string;
    }
  | {
      ok: true;
      provider: "wayforpay";
      action: string;
      formFields: Record<string, string | string[]>;
      intentId?: string;
    }
  | {
      ok: true;
      provider: "monobank";
      redirectUrl: string;
      intentId?: string;
    }
  | { ok: false; error: string };

async function postInit(path: string, orderId: string): Promise<InitResponse> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  let payload: InitResponse;
  try {
    payload = (await res.json()) as InitResponse;
  } catch {
    throw new Error("payment_init_invalid_response");
  }
  if (!payload.ok) {
    throw new Error(payload.error || `payment_init_failed_${res.status}`);
  }
  return payload;
}

function submitHiddenForm(action: string, fields: Record<string, string | string[]>): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.style.display = "none";
  form.acceptCharset = "utf-8";
  for (const [key, value] of Object.entries(fields)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = String(v);
      form.appendChild(input);
    }
  }
  document.body.appendChild(form);
  form.submit();
}

export async function startGatewayPayment(
  method: Exclude<PaymentMethod, "manual">,
  orderId: string,
): Promise<void> {
  const path = `/api/public/payments/${method}-init`;
  const result = await postInit(path, orderId);
  if (!result.ok) throw new Error("payment_init_failed");

  if (result.provider === "monobank") {
    window.location.assign(result.redirectUrl);
    return;
  }
  // LiqPay & WayForPay — self-submit form
  submitHiddenForm(result.action, result.formFields);
}
