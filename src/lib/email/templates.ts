/**
 * HTML-шаблони транзакційних листів для замовлень.
 *
 * Стиль — мінімалістичний, table-based для сумісності з усіма поштовими
 * клієнтами (Outlook, Gmail, Apple Mail). Без зовнішніх CSS / iframes.
 *
 * Усі динамічні значення проходять через `escapeHtml` — інʼєкція HTML
 * заборонена.
 */

export type OrderEmailItem = {
  name: string;
  quantity: number;
  unit_price_cents: number;
};

export type OrderEmailContext = {
  brandName: string;
  storeUrl: string; // https://app.example/s/<slug>
  orderUrl: string; // публічне посилання на сторінку замовлення
  orderShortId: string;
  customerName: string | null;
  customerEmail: string;
  totalCents: number;
  currency: string; // "UAH"
  items: OrderEmailItem[];
  paymentMethod: string; // "manual" | "stripe_card" | ...
  paymentInstructions?: string | null;
  shippingSummary?: string | null;
};

export type OrderStatusEmailContext = OrderEmailContext & {
  newStatus: "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(cents: number, currency: string): string {
  const n = (cents / 100).toLocaleString("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n} ${currency}`;
}

const STATUS_LABEL: Record<OrderStatusEmailContext["newStatus"], string> = {
  pending: "Очікує оплати",
  paid: "Оплачено",
  fulfilled: "Відправлено",
  cancelled: "Скасовано",
  refunded: "Повернуто",
};

const STATUS_HEADLINE: Record<OrderStatusEmailContext["newStatus"], string> = {
  pending: "Замовлення прийнято",
  paid: "Дякуємо за оплату",
  fulfilled: "Ваше замовлення відправлено",
  cancelled: "Замовлення скасовано",
  refunded: "Кошти повернуто",
};

const PAYMENT_LABEL: Record<string, string> = {
  manual: "Переказ на карту",
  stripe_card: "Картка (Stripe)",
  liqpay: "LiqPay · картка",
  wayforpay: "WayForPay · картка",
  monobank: "Monobank",
};

function shell(
  brand: string,
  headline: string,
  inner: string,
  ctaUrl: string,
  ctaLabel: string,
): string {
  return `<!DOCTYPE html>
<html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(headline)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
<tr><td style="padding:24px 28px 8px 28px;">
<div style="font-size:13px;font-weight:600;color:#64748b;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(brand)}</div>
<h1 style="margin:8px 0 0 0;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;">${escapeHtml(headline)}</h1>
</td></tr>
<tr><td style="padding:16px 28px 8px 28px;font-size:15px;line-height:1.55;color:#334155;">
${inner}
</td></tr>
<tr><td style="padding:20px 28px 28px 28px;" align="left">
<a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:8px;">${escapeHtml(ctaLabel)}</a>
</td></tr>
<tr><td style="padding:0 28px 24px 28px;border-top:1px solid #e2e8f0;">
<p style="margin:16px 0 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
Цей лист надіслано автоматично за вашою дією на ${escapeHtml(brand)}.
Якщо ви не очікували цей лист — просто проігноруйте.
</p>
</td></tr>
</table>
<div style="margin-top:12px;font-size:11px;color:#94a3b8;">© ${new Date().getFullYear()} ${escapeHtml(brand)}</div>
</td></tr></table></body></html>`;
}

function itemsTable(items: OrderEmailItem[], totalCents: number, currency: string): string {
  const rows = items
    .map((it) => {
      const line = it.unit_price_cents * it.quantity;
      return `<tr>
<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;">${escapeHtml(it.name)}</td>
<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;text-align:right;white-space:nowrap;">× ${it.quantity}</td>
<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${formatMoney(line, currency)}</td>
</tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse;">
${rows}
<tr>
<td style="padding:14px 0 0 0;font-size:14px;color:#64748b;">Разом</td>
<td></td>
<td style="padding:14px 0 0 0;font-size:16px;color:#0f172a;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;">${formatMoney(totalCents, currency)}</td>
</tr></table>`;
}

export function renderOrderConfirmation(ctx: OrderEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = ctx.customerName
    ? `Привіт, ${escapeHtml(ctx.customerName)}!`
    : "Дякуємо за замовлення!";
  const payLabel = PAYMENT_LABEL[ctx.paymentMethod] ?? ctx.paymentMethod;

  const inner = `
<p style="margin:0 0 12px 0;">${greeting}</p>
<p style="margin:0 0 8px 0;">Ми отримали ваше замовлення <strong>#${escapeHtml(ctx.orderShortId)}</strong>. Деталі нижче.</p>
${itemsTable(ctx.items, ctx.totalCents, ctx.currency)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
<tr><td style="padding:6px 0;font-size:13px;color:#64748b;">Спосіб оплати</td><td style="padding:6px 0;font-size:13px;color:#0f172a;text-align:right;">${escapeHtml(payLabel)}</td></tr>
${ctx.shippingSummary ? `<tr><td style="padding:6px 0;font-size:13px;color:#64748b;vertical-align:top;">Доставка</td><td style="padding:6px 0;font-size:13px;color:#0f172a;text-align:right;">${escapeHtml(ctx.shippingSummary)}</td></tr>` : ""}
</table>
${ctx.paymentInstructions ? `<div style="margin-top:18px;padding:14px 16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;font-size:13px;line-height:1.55;color:#334155;"><strong style="color:#0f172a;">Інструкції з оплати:</strong><br>${escapeHtml(ctx.paymentInstructions).replace(/\n/g, "<br>")}</div>` : ""}
<p style="margin:18px 0 0 0;font-size:14px;color:#334155;">Ми звʼяжемось з вами, щойно статус оновиться.</p>`;

  const subject = `Замовлення #${ctx.orderShortId} прийнято — ${ctx.brandName}`;
  const html = shell(
    ctx.brandName,
    "Замовлення прийнято",
    inner,
    ctx.orderUrl,
    "Переглянути замовлення",
  );
  const text = [
    greeting,
    "",
    `Замовлення #${ctx.orderShortId}`,
    ...ctx.items.map(
      (i) =>
        `• ${i.name} × ${i.quantity} — ${formatMoney(i.unit_price_cents * i.quantity, ctx.currency)}`,
    ),
    "",
    `Разом: ${formatMoney(ctx.totalCents, ctx.currency)}`,
    `Оплата: ${payLabel}`,
    ctx.shippingSummary ? `Доставка: ${ctx.shippingSummary}` : "",
    ctx.paymentInstructions ? `\n${ctx.paymentInstructions}` : "",
    "",
    `Переглянути: ${ctx.orderUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export function renderOrderStatusUpdate(ctx: OrderStatusEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const headline = STATUS_HEADLINE[ctx.newStatus];
  const statusLabel = STATUS_LABEL[ctx.newStatus];

  let intro = "";
  switch (ctx.newStatus) {
    case "paid":
      intro = `Дякуємо! Оплату за замовлення <strong>#${escapeHtml(ctx.orderShortId)}</strong> отримано. Готуємо до відправки.`;
      break;
    case "fulfilled":
      intro = `Ваше замовлення <strong>#${escapeHtml(ctx.orderShortId)}</strong> передано в доставку. Очікуйте на повідомлення від перевізника.`;
      break;
    case "cancelled":
      intro = `Замовлення <strong>#${escapeHtml(ctx.orderShortId)}</strong> скасовано. Якщо це сталось помилково — звʼяжіться з нами.`;
      break;
    case "refunded":
      intro = `Кошти за замовлення <strong>#${escapeHtml(ctx.orderShortId)}</strong> повернуто на ваш рахунок.`;
      break;
    default:
      intro = `Статус замовлення <strong>#${escapeHtml(ctx.orderShortId)}</strong> оновлено: <strong>${escapeHtml(statusLabel)}</strong>.`;
  }

  const inner = `
<p style="margin:0 0 12px 0;">${ctx.customerName ? `Привіт, ${escapeHtml(ctx.customerName)}!` : "Вітаємо!"}</p>
<p style="margin:0 0 12px 0;">${intro}</p>
<div style="display:inline-block;padding:6px 12px;background:#f1f5f9;border-radius:999px;font-size:12px;font-weight:600;color:#0f172a;letter-spacing:0.02em;">${escapeHtml(statusLabel.toUpperCase())}</div>
${itemsTable(ctx.items, ctx.totalCents, ctx.currency)}`;

  const subject = `${headline} — #${ctx.orderShortId}`;
  const html = shell(ctx.brandName, headline, inner, ctx.orderUrl, "Переглянути замовлення");
  const text = [
    ctx.customerName ? `Привіт, ${ctx.customerName}!` : "Вітаємо!",
    "",
    intro.replace(/<[^>]+>/g, ""),
    `Статус: ${statusLabel}`,
    "",
    ...ctx.items.map(
      (i) =>
        `• ${i.name} × ${i.quantity} — ${formatMoney(i.unit_price_cents * i.quantity, ctx.currency)}`,
    ),
    `Разом: ${formatMoney(ctx.totalCents, ctx.currency)}`,
    "",
    `Переглянути: ${ctx.orderUrl}`,
  ].join("\n");

  return { subject, html, text };
}
