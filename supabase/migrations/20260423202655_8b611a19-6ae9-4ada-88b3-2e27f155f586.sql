DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pending'
                 AND enumtypid = 'public.tenant_status'::regtype) THEN
    ALTER TYPE public.tenant_status ADD VALUE 'pending';
  END IF;
END$$;