REVOKE EXECUTE ON FUNCTION public.create_my_tenant(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_onboarding_product(uuid, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.import_onboarding_customers(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_tenant_payment_method(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_telegram_owner_pairing(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_tenant_integration(uuid, text, text, jsonb, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_tenant_integration_webhook_secret(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_owner_test_notification(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_my_tenant(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_onboarding_product(uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_onboarding_customers(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_payment_method(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_telegram_owner_pairing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_tenant_integration(uuid, text, text, jsonb, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_integration_webhook_secret(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_owner_test_notification(uuid) TO authenticated;