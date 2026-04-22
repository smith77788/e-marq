-- Виправлення silent-багу: інтеграція DN Trade для tenant Basic food
-- була записана з provider='basicfood' замість 'dntrade'.
-- Через це жоден з cron-job, webhook-handler, health-monitor її не бачив.
UPDATE public.tenant_integrations
SET provider = 'dntrade'
WHERE provider = 'basicfood';