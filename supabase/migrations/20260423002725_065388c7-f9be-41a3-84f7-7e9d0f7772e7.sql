-- Активуємо outreach для Basic food
UPDATE public.outreach_settings
SET value = '{"reddit":true,"google":true,"blog":true,"telegram":true,"instagram":false}'::jsonb,
    updated_at = now()
WHERE tenant_id='abec86dc-dfa9-4cde-adc3-c813b7ec455f' AND key='active_channels';

INSERT INTO public.outreach_settings (tenant_id, key, value)
VALUES ('abec86dc-dfa9-4cde-adc3-c813b7ec455f', 'reddit_subreddits',
  '["Ukraine","ukraina","Lviv","Kyiv","ukrainian","ua","kyivukraine","Ukrainefood","FoodUkraine","cooking","MealPrepSunday","raw","rawpetfood","BARFraw","dogfood","puppy101","petfood","Pets"]'::jsonb)
ON CONFLICT (tenant_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

INSERT INTO public.outreach_settings (tenant_id, key, value)
VALUES ('abec86dc-dfa9-4cde-adc3-c813b7ec455f', 'intent_keywords',
  '["шукаю","порадьте","де купити","що краще","корм","печінка","легені","субпродукти","для собаки","для кота","натуральне","сире","BARF","рекомендуйте","ринок","якісне м''ясо","українські виробники","raw food","raw diet","liver","organ meat","where to buy","recommend","best brand","high quality"]'::jsonb)
ON CONFLICT (tenant_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- Знизимо мін intent для Telegram, бо ніша вузька
INSERT INTO public.outreach_settings (tenant_id, key, value)
VALUES ('abec86dc-dfa9-4cde-adc3-c813b7ec455f', 'telegram_min_intent_score', '0.18'::jsonb)
ON CONFLICT (tenant_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();