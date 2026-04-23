-- Унікальний індекс для дедуплікації замовлень за зовнішнім ID (Shopify/Woo/Stripe).
-- Часткове індексування — тільки для рядків, де external_id існує.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tenant_external_id
  ON public.orders (tenant_id, ((metadata->>'external_id')))
  WHERE (metadata->>'external_id') IS NOT NULL;

-- Індекс для швидких пошуків за external_id (lookup при upsert)
CREATE INDEX IF NOT EXISTS idx_orders_external_id
  ON public.orders ((metadata->>'external_id'))
  WHERE (metadata->>'external_id') IS NOT NULL;