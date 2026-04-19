
ACOS-ULTRA Loop Status: Foundation + Auth + Tenant Detail shell готові. Тепер потрібен наступний high-impact крок.

Decision filter (3 агенти):
- GROWTH: без продуктів немає чого продавати → Product CRUD = direct revenue enabler
- UX: tenant admin зараз не може нічого зробити з tenant → CRUD усуває friction
- SYSTEM: products таблиця + RLS вже готові, потрібен лише UI шар

Top action: **Step 5 — Product CRUD** на вкладці Products у `/admin/tenants/$tenantId`.

## Plan: Product CRUD

### 1. Create reusable ProductForm component
File: `src/components/admin/ProductForm.tsx`
- Поля: name, sku, price (у доларах, конвертація в cents), currency, stock, description, image_url, is_active
- Валідація: name required, price >= 0, stock >= 0
- Працює і для create, і для edit (props: initialValues, onSubmit, isPending)

### 2. Update Products tab in `admin.tenants.$tenantId.tsx`
- Додати кнопку **"+ New product"** у CardHeader
- Dialog з ProductForm для створення (insert у `products` з tenant_id)
- В кожному рядку таблиці — actions column:
  - **Edit** (Dialog з ProductForm, prefilled)
  - **Toggle active** (Switch у колонці Status — інлайн оновлення is_active)
  - **Delete** (AlertDialog для підтвердження)
- Mutations через TanStack Query + invalidate `["tenant-products", tenantId]`
- Toast feedback (sonner) для всіх операцій

### 3. Mutations (всі через supabase client + RLS)
- `createProduct`: insert {tenant_id, name, sku, price_cents, currency, stock, description, image_url, is_active}
- `updateProduct`: update by id
- `deleteProduct`: delete by id (потрібна tenant_admin роль — RLS вже це enforce)
- `toggleActive`: update {is_active}

### 4. UX details
- Price input у форматі "12.99" (number step 0.01) → store як `Math.round(value * 100)`
- При відкритті форми редагування: `price_cents / 100` показати у dollars
- Empty state у таблиці залишається як є
- Loading states на кнопках через `isPending`

### Files affected
- NEW: `src/components/admin/ProductForm.tsx`
- EDIT: `src/routes/_authenticated/admin.tenants.$tenantId.tsx` (Products tab + mutations)

### Unchanged
- Schema, RLS, auth, інші вкладки (Overview, Config), routing

### Expected impact
- Tenant admin може заповнити каталог → прямий unlock для orders → revenue
- Усуває залежність від manual SQL для seed-даних

### Next loop focus
- Step 6: Config editor (JSON editor для ui/features/bot/seo)
- Step 7: Seed-кнопка "Generate demo events" для funnel-аналітики
