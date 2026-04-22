/**
 * Маркетингові / lifecycle email-шаблони:
 *  - abandoned-cart: повернути покупця у незавершений кошик
 *  - winback: повернути «сплячого» клієнта (з персональним промокодом)
 *  - post-purchase: попросити відгук після доставки
 *  - restock: товар знову в наявності
 *
 * Стиль ідентичний `templates.ts` (table-based, escapeHtml).
 */
import { escapeHtml } from "./templates";

type CommonCtx = {
  brandName: string;
  storeUrl: string;
  customerName: string | null;
  /** Маркетингові листи завжди мусять мати посилання на відписку. */
  unsubscribeUrl: string;
};

function shellMarketing(
  brand: string,
  headline: string,
  inner: string,
  ctaUrl: string,
  ctaLabel: string,
  unsubscribeUrl: string,
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
Ви отримали цей лист, бо є клієнтом ${escapeHtml(brand)}.
<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8;text-decoration:underline;">Відписатися від маркетингових листів</a>
</p>
</td></tr>
</table>
<div style="margin-top:12px;font-size:11px;color:#94a3b8;">© ${new Date().getFullYear()} ${escapeHtml(brand)}</div>
</td></tr></table></body></html>`;
}

// ─────────────────────────── Abandoned Cart ────────────────────────────────
export type AbandonedCartCtx = CommonCtx & {
  cartUrl: string;
  productNames: string[];
  cartValueCents: number;
  currency: string;
};

export function renderAbandonedCart(ctx: AbandonedCartCtx): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = ctx.customerName ? `Привіт, ${escapeHtml(ctx.customerName)}!` : "Вітаємо!";
  const productList = ctx.productNames
    .slice(0, 5)
    .map((n) => `<li style="margin:4px 0;">${escapeHtml(n)}</li>`)
    .join("");
  const totalLine = `${(ctx.cartValueCents / 100).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${escapeHtml(ctx.currency)}`;

  const inner = `
<p style="margin:0 0 12px 0;">${greeting}</p>
<p style="margin:0 0 12px 0;">Ви залишили товари у кошику. Хочете завершити замовлення?</p>
<ul style="margin:0 0 12px 16px;padding:0;font-size:14px;color:#334155;">${productList}</ul>
<p style="margin:0 0 8px 0;font-size:14px;color:#64748b;">Сума: <strong style="color:#0f172a;">${totalLine}</strong></p>
<p style="margin:14px 0 0 0;font-size:13px;color:#94a3b8;">Кошик зберігається 24 години.</p>`;

  const subject = `Ви залишили товари в кошику — ${ctx.brandName}`;
  const html = shellMarketing(
    ctx.brandName,
    "Завершіть замовлення",
    inner,
    ctx.cartUrl,
    "Повернутися до кошика",
    ctx.unsubscribeUrl,
  );
  const text = [
    greeting,
    "",
    "Ви залишили товари у кошику:",
    ...ctx.productNames.slice(0, 5).map((n) => `• ${n}`),
    "",
    `Сума: ${totalLine}`,
    "",
    `Завершити: ${ctx.cartUrl}`,
    "",
    `Відписатися: ${ctx.unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}

// ─────────────────────────── Winback ───────────────────────────────────────
export type WinbackCtx = CommonCtx & {
  promoCode: string;
  discountPct: number;
  expiresAt: string; // ISO
  daysSinceLastOrder: number;
};

export function renderWinback(ctx: WinbackCtx): { subject: string; html: string; text: string } {
  const greeting = ctx.customerName ? `${escapeHtml(ctx.customerName)},` : "Вітаємо!";
  const expDate = new Date(ctx.expiresAt).toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "long",
  });

  const inner = `
<p style="margin:0 0 12px 0;">${greeting}</p>
<p style="margin:0 0 12px 0;">Ми сумуємо за вами. Минуло вже ${ctx.daysSinceLastOrder} днів від вашого останнього замовлення.</p>
<div style="margin:18px 0;padding:16px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;text-align:center;">
  <div style="font-size:12px;color:#64748b;letter-spacing:0.04em;text-transform:uppercase;">Персональна знижка</div>
  <div style="font-size:32px;font-weight:700;color:#0f172a;margin:6px 0;">−${ctx.discountPct}%</div>
  <div style="font-size:14px;color:#334155;">Промокод: <strong style="font-family:monospace;font-size:16px;color:#0f172a;">${escapeHtml(ctx.promoCode)}</strong></div>
  <div style="font-size:12px;color:#94a3b8;margin-top:6px;">Діє до ${escapeHtml(expDate)}</div>
</div>`;

  const subject = `Ваша знижка ${ctx.discountPct}% чекає — ${ctx.brandName}`;
  const html = shellMarketing(
    ctx.brandName,
    "Повертайтеся з подарунком",
    inner,
    ctx.storeUrl,
    "Перейти в магазин",
    ctx.unsubscribeUrl,
  );
  const text = [
    greeting,
    "",
    `Минуло ${ctx.daysSinceLastOrder} днів. Ось персональна знижка ${ctx.discountPct}%.`,
    `Промокод: ${ctx.promoCode}`,
    `Діє до ${expDate}`,
    "",
    `Магазин: ${ctx.storeUrl}`,
    "",
    `Відписатися: ${ctx.unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}

// ─────────────────────────── Post-Purchase (Review) ────────────────────────
export type PostPurchaseCtx = CommonCtx & {
  orderShortId: string;
  productNames: string[];
  reviewUrl: string;
};

export function renderPostPurchase(ctx: PostPurchaseCtx): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = ctx.customerName ? `Привіт, ${escapeHtml(ctx.customerName)}!` : "Вітаємо!";
  const productLine = ctx.productNames.slice(0, 3).join(", ");

  const inner = `
<p style="margin:0 0 12px 0;">${greeting}</p>
<p style="margin:0 0 12px 0;">Сподіваємось, ваше замовлення <strong>#${escapeHtml(ctx.orderShortId)}</strong> вже прийшло.</p>
<p style="margin:0 0 12px 0;">Чи могли б ви приділити хвилину і поділитися враженнями про <strong>${escapeHtml(productLine)}</strong>? Ваш відгук допомагає іншим зробити правильний вибір.</p>`;

  const subject = `Як вам ваше замовлення? — ${ctx.brandName}`;
  const html = shellMarketing(
    ctx.brandName,
    "Поділіться враженнями",
    inner,
    ctx.reviewUrl,
    "Залишити відгук",
    ctx.unsubscribeUrl,
  );
  const text = [
    greeting,
    "",
    `Дякуємо за замовлення #${ctx.orderShortId}.`,
    `Будь ласка, поділіться враженнями: ${ctx.reviewUrl}`,
    "",
    `Відписатися: ${ctx.unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}

// ─────────────────────────── Restock ───────────────────────────────────────
export type RestockCtx = CommonCtx & {
  productName: string;
  productUrl: string;
};

export function renderRestock(ctx: RestockCtx): { subject: string; html: string; text: string } {
  const greeting = ctx.customerName ? `Привіт, ${escapeHtml(ctx.customerName)}!` : "Гарна новина!";

  const inner = `
<p style="margin:0 0 12px 0;">${greeting}</p>
<p style="margin:0 0 12px 0;"><strong>${escapeHtml(ctx.productName)}</strong> знову в наявності!</p>
<p style="margin:0 0 12px 0;font-size:14px;color:#64748b;">Ви підписалися на повідомлення про наявність цього товару. Поспішайте — кількість обмежена.</p>`;

  const subject = `${ctx.productName} знову в наявності — ${ctx.brandName}`;
  const html = shellMarketing(
    ctx.brandName,
    "Товар знову в наявності",
    inner,
    ctx.productUrl,
    "Перейти до товару",
    ctx.unsubscribeUrl,
  );
  const text = [
    greeting,
    "",
    `${ctx.productName} знову в наявності.`,
    `Перейти: ${ctx.productUrl}`,
    "",
    `Відписатися: ${ctx.unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}
