-- Notify owner via Telegram when a new paid order arrives.
-- Reuses the existing notify_owner_telegram pipeline by inserting into
-- owner_notifications with severity='high' (which already triggers a TG push).

CREATE OR REPLACE FUNCTION public.tg_notify_owner_on_new_paid_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _has_chat boolean;
  _brand text;
  _amount text;
BEGIN
  -- Only act when status flips to 'paid'
  IF NEW.status <> 'paid' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN
    RETURN NEW;
  END IF;

  -- Skip if owner has not bound a chat
  SELECT (owner_telegram_chat_id IS NOT NULL AND owner_telegram_chat_id <> ''),
         coalesce(brand_name, 'Бренд')
    INTO _has_chat, _brand
    FROM public.tenant_configs
   WHERE tenant_id = NEW.tenant_id;

  IF NOT _has_chat THEN
    RETURN NEW;
  END IF;

  _amount := to_char(NEW.total_cents::numeric / 100, 'FM999G999G990D00');

  INSERT INTO public.owner_notifications
    (tenant_id, kind, severity, title, body, link, metadata)
  VALUES (
    NEW.tenant_id,
    'order_paid',
    'high',
    '💰 Нове оплачене замовлення',
    format('Сума: %s ₴%s%s',
      _amount,
      coalesce(' · ' || NEW.customer_name, ''),
      coalesce(' · ' || NEW.customer_email, '')
    ),
    '/brand/orders?tenant=' || NEW.tenant_id::text || '#order-' || NEW.id::text,
    jsonb_build_object('order_id', NEW.id, 'amount_cents', NEW.total_cents)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tg_notify_owner_new_paid_order ON public.orders;
CREATE TRIGGER trg_tg_notify_owner_new_paid_order
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_notify_owner_on_new_paid_order();