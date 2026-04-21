-- Sync data from Basicfood (basicfood.lovable.app) into Basic food tenant
-- Tenant: abec86dc-dfa9-4cde-adc3-c813b7ec455f

-- 1) Remove stale placeholder products (only those NOT in Basicfood source)
DELETE FROM products
WHERE tenant_id = 'abec86dc-dfa9-4cde-adc3-c813b7ec455f'
  AND id NOT IN (
    '95e0731c-3c30-4a51-b2e2-4b62869e17d5',
    'eb51211a-eeb9-408c-b55e-456cbdb560e4',
    '1469de08-d526-4768-98be-62ecec1cf776',
    'c6891487-cb7b-4ec7-a881-3677ebaa21ba',
    '350834c9-7a3e-4a6f-9bf9-e280117c4037',
    '7a425265-5fc2-47ae-8996-53d41f15d53b',
    'af3f9e10-8830-4598-923a-a7b6dc079688',
    '6f0d7e25-7c1f-4e4a-9d04-2e6c8b9ad4e1',
    '8f5b2c1d-9e8f-4a7b-8c6d-1234567890ab',
    'ffffffff-ffff-ffff-ffff-ffffffffffff'
  );

-- 2) Upsert 10 products from Basicfood
INSERT INTO products (id, tenant_id, name, description, price_cents, currency, image_url, stock, is_active, metadata) VALUES
('95e0731c-3c30-4a51-b2e2-4b62869e17d5','abec86dc-dfa9-4cde-adc3-c813b7ec455f','Легені яловичі','🫁 Натуральні сушені яловичі легені для собак і котів — низькокалорійні ласощі №1 для дресури. 100% натуральне м''ясо без консервантів, барвників та солі. Виготовлено в Україні методом холодного сушіння при 40°C.',10500,'UAH','https://xtddyelymvcgnskcenti.supabase.co/storage/v1/object/public/product-images/legen-ialovych-95e0731c.jpg',1500,true,'{"categories":["dogs","cats","training"],"weight":"100 г","protein":"70 г","fat":"4 г","calories":"320 ккал","sold_count":35,"is_bestseller":true,"is_featured":true,"source":"basicfood"}'::jsonb),
('eb51211a-eeb9-408c-b55e-456cbdb560e4','abec86dc-dfa9-4cde-adc3-c813b7ec455f','Шия куряча','🐔 Натуральні сушені курячі шиї для собак малих і середніх порід. Хрустка закуска для зубів, багата на колаген та глюкозамін. 100% натуральне м''ясо.',9000,'UAH','https://xtddyelymvcgnskcenti.supabase.co/storage/v1/object/public/product-images/shyia-kuriacha-eb51211a.jpg',1500,true,'{"categories":["dogs","training","cats"],"weight":"100 г","protein":"58 г","fat":"15 г","calories":"340 ккал","sold_count":83,"source":"basicfood"}'::jsonb),
('1469de08-d526-4768-98be-62ecec1cf776','abec86dc-dfa9-4cde-adc3-c813b7ec455f','Аорта яловича','❤️ Натуральна сушена яловича аорта — щільні жувальні ласощі для активних собак. Тривале жування знімає стрес, чистить зуби. Багата на еластин і колаген.',10500,'UAH','https://xtddyelymvcgnskcenti.supabase.co/storage/v1/object/public/product-images/aorta-ialovycha-1469de08.jpg',1500,true,'{"categories":["dogs"],"weight":"100 г","protein":"64 г","fat":"12 г","calories":"350 ккал","sold_count":66,"is_bestseller":true,"is_featured":true,"source":"basicfood"}'::jsonb),
('c6891487-cb7b-4ec7-a881-3677ebaa21ba','abec86dc-dfa9-4cde-adc3-c813b7ec455f','Рубець яловичий','🌿 Натуральний сушений яловичий рубець — рекордсмен за вмістом природних ферментів і пробіотиків. Покращує травлення.',10500,'UAH','https://xtddyelymvcgnskcenti.supabase.co/storage/v1/object/public/product-images/rubets-ialovychyi-c6891487.jpg',1500,true,'{"categories":["dogs"],"weight":"100 г","protein":"62 г","fat":"11 г","calories":"330 ккал","sold_count":44,"source":"basicfood"}'::jsonb),
('350834c9-7a3e-4a6f-9bf9-e280117c4037','abec86dc-dfa9-4cde-adc3-c813b7ec455f','Печінка яловича','🥩 Натуральна сушена яловича печінка — найбагатше джерело заліза, вітамінів A, B12 та фолієвої кислоти. Топ-смаколик для дресури.',10500,'UAH','https://xtddyelymvcgnskcenti.supabase.co/storage/v1/object/public/product-images/pechnka-ialovycha-350834c9.jpg',1500,true,'{"categories":["dogs","cats","training"],"weight":"100 г","protein":"72 г","fat":"8 г","calories":"345 ккал","sold_count":53,"is_bestseller":true,"is_featured":true,"source":"basicfood"}'::jsonb),
('7a425265-5fc2-47ae-8996-53d41f15d53b','abec86dc-dfa9-4cde-adc3-c813b7ec455f','Трахея яловича','Сушена яловича трахея — натуральне джерело хондроїтину та глюкозаміну. Підтримує здоров''я суглобів та зв''язок.',10500,'UAH','https://xtddyelymvcgnskcenti.supabase.co/storage/v1/object/public/product-images/trakheia-ialovycha-7a425265.jpg',1500,true,'{"categories":["dogs"],"weight":"100 г","protein":"60 г","fat":"10 г","calories":"325 ккал","sold_count":51,"source":"basicfood"}'::jsonb),
('af3f9e10-8830-4598-923a-a7b6dc079688','abec86dc-dfa9-4cde-adc3-c813b7ec455f','Вим''я яловиче','Сушене яловиче вим''я — м''який жувальний делікатес, багатий на природні жири та білок. Для собак з чутливими зубами.',10500,'UAH','https://xtddyelymvcgnskcenti.supabase.co/storage/v1/object/public/product-images/vymia-ialovyche-af3f9e10.jpg',1500,true,'{"categories":["dogs","cats","training"],"weight":"100 г","protein":"55 г","fat":"20 г","calories":"360 ккал","sold_count":42,"source":"basicfood"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  currency = EXCLUDED.currency,
  image_url = EXCLUDED.image_url,
  stock = EXCLUDED.stock,
  is_active = EXCLUDED.is_active,
  metadata = products.metadata || EXCLUDED.metadata,
  updated_at = now();

-- 3) Upsert promotions from Basicfood
INSERT INTO promotions (id, tenant_id, code, name, promo_type, value, starts_at, ends_at, is_active, agent) VALUES
('a8c62d39-e0eb-4482-bd25-005a70653f77','abec86dc-dfa9-4cde-adc3-c813b7ec455f','BF-EASTER10','Пасхальна знижка -10%','percent_off',10,'2026-04-11 00:00:00+00','2026-04-16 00:00:00+00',false,'imported_from_basicfood'),
('b1000000-0000-0000-0000-000000000001','abec86dc-dfa9-4cde-adc3-c813b7ec455f','BF-WELCOME','Перше замовлення -15%','percent_off',15,'2026-01-01 00:00:00+00','2027-01-01 00:00:00+00',true,'imported_from_basicfood'),
('b1000000-0000-0000-0000-000000000002','abec86dc-dfa9-4cde-adc3-c813b7ec455f','BF-SUMMER','Літня знижка -10%','percent_off',10,'2026-06-01 00:00:00+00','2026-08-31 00:00:00+00',true,'imported_from_basicfood')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  promo_type = EXCLUDED.promo_type,
  value = EXCLUDED.value,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- 4) Update tenant_configs brand info
UPDATE tenant_configs SET
  brand_name = 'BASIC.FOOD — натуральні ласощі для тварин',
  seo = COALESCE(seo, '{}'::jsonb) || '{"site_url": "https://basicfood.lovable.app", "language": "ua", "currency": "UAH"}'::jsonb,
  updated_at = now()
WHERE tenant_id = 'abec86dc-dfa9-4cde-adc3-c813b7ec455f';