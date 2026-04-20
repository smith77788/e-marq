-- 1. Add payment columns to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS payment_ref text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Validate payment_method values via trigger (not CHECK to allow future expansion)
CREATE OR REPLACE FUNCTION public.validate_order_payment_method()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_method NOT IN ('stripe_card', 'manual') THEN
    RAISE EXCEPTION 'Invalid payment_method: %', NEW.payment_method;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_order_payment_method_trg ON public.orders;
CREATE TRIGGER validate_order_payment_method_trg
BEFORE INSERT OR UPDATE OF payment_method ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.validate_order_payment_method();

-- 2. Stock adjustment trigger on order status change
CREATE OR REPLACE FUNCTION public.adjust_stock_on_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item record;
BEGIN
  -- pending/paid: when transitioning into 'paid', decrement stock
  IF (TG_OP = 'UPDATE') AND NEW.status = 'paid' AND OLD.status <> 'paid' THEN
    FOR item IN
      SELECT product_id, quantity
      FROM public.order_items
      WHERE order_id = NEW.id AND product_id IS NOT NULL
    LOOP
      UPDATE public.products
      SET stock = GREATEST(0, stock - item.quantity)
      WHERE id = item.product_id;
    END LOOP;

    IF NEW.paid_at IS NULL THEN
      NEW.paid_at := now();
    END IF;
  END IF;

  -- Restock if a paid order is cancelled or refunded
  IF (TG_OP = 'UPDATE') AND OLD.status = 'paid' AND NEW.status IN ('cancelled', 'refunded') THEN
    FOR item IN
      SELECT product_id, quantity
      FROM public.order_items
      WHERE order_id = NEW.id AND product_id IS NOT NULL
    LOOP
      UPDATE public.products
      SET stock = stock + item.quantity
      WHERE id = item.product_id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS adjust_stock_on_order_status_trg ON public.orders;
CREATE TRIGGER adjust_stock_on_order_status_trg
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.adjust_stock_on_order_status();

-- 3. Updated_at trigger on orders (if not exists)
DROP TRIGGER IF EXISTS update_orders_updated_at ON public.orders;
CREATE TRIGGER update_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. RPC: mark order as paid (for manual payments by tenant managers)
CREATE OR REPLACE FUNCTION public.mark_order_paid(_order_id uuid, _payment_ref text DEFAULT NULL)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order public.orders;
BEGIN
  SELECT * INTO _order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_order.tenant_id)) THEN
    RAISE EXCEPTION 'Not authorized to mark order as paid';
  END IF;

  IF _order.status = 'paid' THEN
    RETURN _order;
  END IF;

  UPDATE public.orders
  SET status = 'paid',
      payment_ref = COALESCE(_payment_ref, payment_ref),
      paid_at = now()
  WHERE id = _order_id
  RETURNING * INTO _order;

  RETURN _order;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_order_paid(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(uuid, text) TO authenticated;

-- 5. RPC: cancel order (for tenant admins)
CREATE OR REPLACE FUNCTION public.cancel_order(_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order public.orders;
BEGIN
  SELECT * INTO _order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_order.tenant_id)) THEN
    RAISE EXCEPTION 'Not authorized to cancel order';
  END IF;

  UPDATE public.orders
  SET status = 'cancelled'
  WHERE id = _order_id
  RETURNING * INTO _order;

  RETURN _order;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid) TO authenticated;

-- 6. Index for tenant order listing
CREATE INDEX IF NOT EXISTS orders_tenant_created_idx
  ON public.orders (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_tenant_status_idx
  ON public.orders (tenant_id, status);