---
name: Shopify webhook receiver
description: HMAC-SHA256 verified inbound webhooks for Shopify orders/products/customers, on shared /api/public/integrations/inbound/shopify endpoint
type: feature
---

Shopify webhooks приймаються через `/api/public/integrations/inbound/$provider` з `provider=shopify`.

**Authentication path** (відрізняється від generic):

- `X-Shopify-Hmac-Sha256` header — base64(HMAC-SHA256(rawBody, webhook_secret))
- `webhook_secret` зберігається у `tenant_integrations.webhook_secret` (той самий стовпчик що й generic) — користувач ставить ОДИН секрет як у Shopify Admin → Notifications, так і у нас.
- Comparison через `crypto.timingSafeEqual` — never-string-compare.

**Topic mapping** (читаємо з `X-Shopify-Topic`):

- `products/*` → entity=products
- `customers/*` → entity=customers
- `orders/*` → entity=orders

**Payload-адаптер**: Shopify шле один обʼєкт (не {entity, rows}). `shopifyEntityToRow()` нормалізує його у канонічний row, який далі обробляє існуючий import loop (upsert по sku/email/external_id).

**Important**: rawBody читається ОДИН раз через `request.text()` — потрібен як для HMAC, так і для JSON.parse. Не використовувати `request.json()` — тоді HMAC валідація неможлива.

**Onboarding URL для користувача**:
`https://e-marq.lovable.app/api/public/integrations/inbound/shopify?tenant=<tenant_id>`
