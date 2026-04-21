
-- =====================================================================
-- Sprint 6: restock notifications + email autoresponder support
-- =====================================================================

-- Таблиця підписок на повідомлення про повернення товару в наявність
CREATE TABLE public.restock_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','notified','cancelled')),
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id, variant_id, customer_email)
);
CREATE INDEX idx_restock_pending ON public.restock_notifications(tenant_id, product_id) WHERE status = 'pending';

ALTER TABLE public.restock_notifications ENABLE ROW LEVEL SECURITY;

-- Власники бачать підписки свого тенанта
CREATE POLICY "restock_member_read" ON public.restock_notifications FOR SELECT TO authenticated
  USING (is_super_admin() OR is_tenant_member(tenant_id));
-- Власники можуть скасувати/змінити
CREATE POLICY "restock_admin_write" ON public.restock_notifications FOR ALL TO authenticated
  USING (is_super_admin() OR is_tenant_admin(tenant_id))
  WITH CHECK (is_super_admin() OR is_tenant_admin(tenant_id));
-- Анонімні відвідувачі сторфронту створюють підписки
CREATE POLICY "restock_anon_insert" ON public.restock_notifications FOR INSERT TO anon
  WITH CHECK (true);

-- Колонка для відстеження "був не в наявності" — щоб знати коли товар повернувся
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS was_out_of_stock BOOLEAN NOT NULL DEFAULT false;

-- Тригер: коли stock переходить з 0 → >0, ставимо was_out_of_stock=true (один раз)
-- агент restock-notifier його зчитує, надсилає листи і скидає у false
CREATE OR REPLACE FUNCTION public.mark_restock_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.stock = 0 AND NEW.stock > 0 THEN
    NEW.was_out_of_stock := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_restock_transition ON public.products;
CREATE TRIGGER trg_products_restock_transition
  BEFORE UPDATE OF stock ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_restock_transition();
