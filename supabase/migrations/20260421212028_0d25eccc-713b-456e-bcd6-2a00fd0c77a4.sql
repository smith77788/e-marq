
-- 1. Додаємо два нові продукти з Basicfood
INSERT INTO public.products (id, tenant_id, name, description, price_cents, currency, image_url, stock, is_active, metadata)
VALUES
('7b036fba-595f-407a-b42f-9cee84625982', 'abec86dc-dfa9-4cde-adc3-c813b7ec455f',
  '🎁 Дегустаційний набір',
  '🎁 Дегустаційний набір BASIC.FOOD — 3 топ-позиції по 100 г: легені, печінка, рубець. Ідеальний подарунок або старт знайомства з натуральними ласощами для собак і котів.',
  30000, 'UAH',
  'https://xtddyelymvcgnskcenti.supabase.co/storage/v1/object/public/product-images/tasting-set.jpg',
  100, true,
  jsonb_build_object('source','basicfood','weight','300 г','category','set')
),
('8609fcf5-b175-4a73-b248-a3261a7a409a', 'abec86dc-dfa9-4cde-adc3-c813b7ec455f',
  'Пеніс яловичий',
  'Сушений яловичий пеніс (бичачий корінь) — найміцніший і найдовший натуральний жувальник преміум-класу. Чистить зуби, знімає стрес, безпечно займає енергійних собак на годину.',
  25000, 'UAH',
  'https://xtddyelymvcgnskcenti.supabase.co/storage/v1/object/public/product-images/pens-ialovychyi-8609fcf5.jpg',
  50, true,
  jsonb_build_object('source','basicfood','weight','100 г','category','chew')
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  image_url = EXCLUDED.image_url,
  metadata = public.products.metadata || EXCLUDED.metadata,
  updated_at = now();

-- 2. Маркуємо ВСІ продукти tenant як basicfood
UPDATE public.products
SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('source','basicfood','last_sync_check', now()::text)
WHERE tenant_id = 'abec86dc-dfa9-4cde-adc3-c813b7ec455f'
  AND COALESCE(metadata->>'source','') <> 'basicfood';

-- 3. Імпортуємо відгуки як social_proof_events
INSERT INTO public.social_proof_events (tenant_id, event_type, product_id, display_text, metadata, is_active, expires_at, created_at)
VALUES
('abec86dc-dfa9-4cde-adc3-c813b7ec455f', 'review', '350834c9-7a3e-4a6f-9bf9-e280117c4037',
  'Андрій (🐕 Каспер, стаффорд): «Беру для дресирування — печінка, легені та вим''я маленькими шматочками ідеально. Собака працює на 200% коли знає, що буде нагорода!» ⭐⭐⭐⭐⭐',
  jsonb_build_object('rating',5,'author','Андрій','pet','🐕 Каспер, стаффорд','source','basicfood','external_id','909e66f4-2dc0-4f29-8e08-82eca7fc8aeb'),
  true, now() + interval '180 days', '2026-04-08T13:10:09Z'),
('abec86dc-dfa9-4cde-adc3-c813b7ec455f', 'review', '95e0731c-3c30-4a51-b2e2-4b62869e17d5',
  'Олена К. (🐕 Боніта, лабрадор): «Бонні обожнює яловичі легені! Нарешті знайшли ласощі без хімії.» ⭐⭐⭐⭐⭐',
  jsonb_build_object('rating',5,'author','Олена К.','pet','🐕 Боніта, лабрадор','source','basicfood','external_id','ce486d0a-ac6c-4b19-a5cf-9125d6cc1760'),
  true, now() + interval '180 days', '2026-04-08T13:10:09Z'),
('abec86dc-dfa9-4cde-adc3-c813b7ec455f', 'review', 'c6891487-cb7b-4ec7-a881-3677ebaa21ba',
  'Тарас Х. (🐕 Джек, бігль): «Дегустаційний набір — найкраще рішення для початку. Тепер знаємо, що він найбільше любить рубець.» ⭐⭐⭐⭐⭐',
  jsonb_build_object('rating',5,'author','Тарас Х.','pet','🐕 Джек, бігль','source','basicfood','external_id','95a73a9e-b373-4a10-a258-56864f524ed3'),
  true, now() + interval '180 days', '2026-04-08T13:10:09Z'),
('abec86dc-dfa9-4cde-adc3-c813b7ec455f', 'review', '95e0731c-3c30-4a51-b2e2-4b62869e17d5',
  'Марина Л. (🐈 Мурчик, британець): «Навіть наш вибагливий кіт їсть ці ласощі! Легені подрібнюю — і він у захваті.» ⭐⭐⭐⭐⭐',
  jsonb_build_object('rating',5,'author','Марина Л.','pet','🐈 Мурчик, британець','source','basicfood','external_id','a442b89d-c56d-4fd0-bbbb-91699af385bf'),
  true, now() + interval '180 days', '2026-04-08T13:10:09Z'),
('abec86dc-dfa9-4cde-adc3-c813b7ec455f', 'review', '7b036fba-595f-407a-b42f-9cee84625982',
  'Лола (🦁 Сара, Чихуахуа): «Цей маленький монстр просто не відходить від шухляди де сховані ласощі від Basic Food! 😂» ⭐⭐⭐⭐⭐',
  jsonb_build_object('rating',5,'author','Лола','pet','🦁 Сара, Чихуахуа','source','basicfood','external_id','16019c78-4e6e-416f-b683-5b92b1fdd3c8'),
  true, now() + interval '180 days', '2026-04-08T17:11:11Z');

-- 4. Журнал імпортів
INSERT INTO public.import_jobs (tenant_id, source_provider, source_kind, entity_kind, status, rows_total, rows_imported, rows_skipped, rows_failed, started_at, finished_at, metadata)
VALUES
('abec86dc-dfa9-4cde-adc3-c813b7ec455f', 'basicfood', 'manual', 'products',
  'completed', 10, 2, 8, 0, now(), now(),
  jsonb_build_object('note','Імпортовано 2 нові продукти з Basicfood, 8 уже існували','sync_url','https://xtddyelymvcgnskcenti.supabase.co')),
('abec86dc-dfa9-4cde-adc3-c813b7ec455f', 'basicfood', 'manual', 'reviews',
  'completed', 5, 5, 0, 0, now(), now(),
  jsonb_build_object('note','Імпортовано 5 reviews як social_proof_events для агентів social-proof-live + UGC'));

-- 5. SEO + бренд
UPDATE public.tenant_configs
SET 
  brand_name = 'BASIC.FOOD',
  ui = COALESCE(ui,'{}'::jsonb) || jsonb_build_object('tagline','Натуральні ласощі для собак і котів','currency','UAH','language','uk'),
  seo = COALESCE(seo,'{}'::jsonb) || jsonb_build_object(
    'title','BASIC.FOOD — натуральні сушені ласощі для собак і котів',
    'description','100% м''ясо, без хімії. Дегустаційні набори, жувальники, преміум-якість українського виробництва.',
    'keywords', ARRAY['натуральні ласощі для собак','сушене м''ясо для котів','дегустаційний набір','жувальники для собак','BASIC.FOOD']
  ),
  updated_at = now()
WHERE tenant_id = 'abec86dc-dfa9-4cde-adc3-c813b7ec455f';
