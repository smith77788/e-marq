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
  _is_pilot boolean;
BEGIN
  IF NEW.status <> 'paid' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN RETURN NEW; END IF;

  -- Pilot-noise guard: skip synthetic / manual orders
  IF NEW.payment_method = 'manual' THEN RETURN NEW; END IF;
  SELECT COALESCE(is_pilot,false) INTO _is_pilot FROM public.tenants WHERE id = NEW.tenant_id;
  IF _is_pilot THEN RETURN NEW; END IF;

  SELECT (owner_telegram_chat_id IS NOT NULL AND owner_telegram_chat_id <> ''),
         coalesce(brand_name, 'Бренд')
    INTO _has_chat, _brand
    FROM public.tenant_configs WHERE tenant_id = NEW.tenant_id;
  IF NOT _has_chat THEN RETURN NEW; END IF;

  _amount := to_char(NEW.total_cents::numeric / 100, 'FM999G999G990D00');

  INSERT INTO public.owner_notifications
    (tenant_id, kind, severity, title, body, link, metadata)
  VALUES (
    NEW.tenant_id, 'order_paid', 'high',
    '💰 Нове оплачене замовлення',
    format('Сума: %s ₴%s%s', _amount,
      coalesce(' · ' || NEW.customer_name, ''),
      coalesce(' · ' || NEW.customer_email, '')),
    '/brand/orders?tenant=' || NEW.tenant_id::text || '#order-' || NEW.id::text,
    jsonb_build_object('order_id', NEW.id, 'amount_cents', NEW.total_cents)
  );

  RETURN NEW;
END;
$$;

-- Cleanup orphan outbox rows from pilot noise (sent, no matching notification)
DELETE FROM public.owner_telegram_outbox o
WHERE source_kind = 'notification'
  AND created_at > now() - interval '7 days'
  AND status = 'sent'
  AND NOT EXISTS (SELECT 1 FROM public.owner_notifications n WHERE n.id = o.source_id);