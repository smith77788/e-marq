UPDATE public.tenant_integrations
SET webhook_secret = '69d9909309f43c65d74647fc391c6b6daa0579df59b500af34ef901320011f2e',
    updated_at = now()
WHERE tenant_id = 'abec86dc-dfa9-4cde-adc3-c813b7ec455f'
  AND provider = 'basicfood';