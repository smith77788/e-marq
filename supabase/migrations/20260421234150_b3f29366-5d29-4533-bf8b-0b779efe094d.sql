
-- Посилення anon insert-policy на restock_notifications
DROP POLICY IF EXISTS "restock_anon_insert" ON public.restock_notifications;

-- Валідація email на рівні CHECK constraint
ALTER TABLE public.restock_notifications
  ADD CONSTRAINT restock_email_format
  CHECK (
    customer_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND length(customer_email) <= 254
  );

-- Лише якщо товар існує і ЗАРАЗ не в наявності
CREATE POLICY "restock_anon_insert" ON public.restock_notifications FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.products p
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE p.id = restock_notifications.product_id
        AND p.tenant_id = restock_notifications.tenant_id
        AND p.is_active = true
        AND p.stock = 0
        AND t.status = 'active'
    )
    AND status = 'pending'
  );
