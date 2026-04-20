

## Step 7+: Generate Demo Data — enhanced version

### Що покращую vs базовий план

Базовий план: 5 продуктів + 100 events.
Покращений: realistic e-commerce симуляція з повноцінним funnel, ордерами, time-distribution за 30 днів і вибором масштабу.

### Що генерується

**8 products** (різні категорії, ціни, stock):
- Premium Hoodie $59 / Classic T-Shirt $24 / Sneakers Pro $129
- Baseball Cap $19 / Canvas Tote $15 / Leather Wallet $45
- Wireless Earbuds $89 / Water Bottle $12

З SKU, description, image_url (Unsplash placeholder), is_active. Skip якщо tenant вже має >=8 продуктів.

**~50 sessions** розподілених за останні **30 днів** (не 7) з реалістичним funnel-decay:
- 50 sessions → 50 page_view
- ~35 → product_view (70% conversion)
- ~18 → add_to_cart (50%)
- ~9 → checkout_start (50%)
- ~5 → purchase (55%)

Total: ~120 events (а не сухих 100), session_id consistent в межах сесії, product_id для product-related events.

**5 orders** (по 1-3 line items кожен) — щоб purchase events мали реальні order_id, total_cents, customer_email, status='paid'.

**Time distribution**: events розкидані за 30 днів через `payload.ts` (бо БД default `now()`), з реалістичним weighting — більше recent events (last 7 days = ~60%).

### UI на Overview tab

Нова Card "Demo data" з:
- Опис що буде згенеровано
- Select scale: **Small** (1×) / **Medium** (3×) / **Large** (10×) — multiplier на sessions/orders, products завжди 8
- Switch "Skip if data exists" (default on)
- Button `Generate demo data` (variant outline, з Sparkles icon)
- AlertDialog confirm з summary що буде створено
- Progress toast: "Creating products… (1/3)" → "Creating orders… (2/3)" → "Generating events… (3/3)"
- Final toast з результатом + invalidation усіх queries

Bonus: button **"Clear demo data"** (variant ghost, destructive text) — видаляє всі products/orders/events tenant'а з confirm dialog. Тільки super_admin.

### Implementation

Один файл:
- EDIT: `src/routes/_authenticated/admin.tenants.$tenantId.tsx`

Виносимо логіку в helper `src/lib/demoData.ts`:
- `generateDemoProducts(tenantId, supabase)` → returns product ids
- `generateDemoOrders(tenantId, productIds, count, supabase)` → returns order ids
- `generateDemoEvents(tenantId, productIds, orderIds, sessionCount, supabase)` → batch insert
- `clearDemoData(tenantId, supabase)` → delete events, order_items, orders, products

NEW: `src/lib/demoData.ts`

### Files
- NEW: `src/lib/demoData.ts`
- EDIT: `src/routes/_authenticated/admin.tenants.$tenantId.tsx`

### Чому це краще
- 30 днів time-spread → можна одразу будувати time-series charts
- Реальні orders + order_items → revenue metrics працюють, не тільки event counts
- Scale selector → можна стресити аналітику великим обʼємом
- Clear button → re-test loop без SQL
- Realistic funnel decay → dashboard виглядатиме як справжній e-commerce, не як random noise

### Next loop
- Step 8: Funnel + revenue chart на Overview (recharts)
- Step 9: Public storefront `/s/$slug`

