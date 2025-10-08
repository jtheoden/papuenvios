# Current Database Schema - Papuenvios
## Last Updated: 2025-10-07 (Post orders_payment_system migration)

> **Purpose:** This document tracks the current state of the Supabase database schema, including all tables, columns, relationships, and RLS policies. It serves as the single source of truth for database structure.

---

## 📊 Tables Overview

**Total Tables:** 29

### 1. **carousel_slides**
```sql
CREATE TABLE public.carousel_slides (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title_es text NOT NULL,
  title_en text NOT NULL,
  subtitle_es text,
  subtitle_en text,
  image_url text,
  image_file text,
  link_url text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Homepage carousel/slider management
**Key Fields:** Bilingual titles, subtitles, image URLs, display ordering
**Status:** ✅ Service created, Context integrated

---

### 2. **cart_items**
```sql
CREATE TABLE public.cart_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cart_id uuid NOT NULL REFERENCES shopping_carts(id),
  item_type text NOT NULL,
  item_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at timestamptz DEFAULT now()
);
```
**Purpose:** Shopping cart items
**Relationships:** → shopping_carts

---

### 3. **combo_items**
```sql
CREATE TABLE public.combo_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  combo_id uuid NOT NULL REFERENCES combo_products(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz DEFAULT now()
);
```
**Purpose:** Links products to combo packages
**Relationships:** → combo_products, → products

---

### 4. **combo_products**
```sql
CREATE TABLE public.combo_products (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name_es text NOT NULL,
  name_en text NOT NULL,
  description_es text,
  description_en text,
  image_url text,
  base_total_price numeric NOT NULL,
  profit_margin numeric DEFAULT 40.00,
  final_price numeric GENERATED AS (base_total_price * (1 + profit_margin / 100)) STORED,
  shipping_free boolean DEFAULT false,
  shipping_discount_percent numeric DEFAULT 0,
  out_of_province_shipping boolean DEFAULT true,
  out_of_province_price numeric,
  is_active boolean DEFAULT true,
  is_featured boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Product combo packages
**Key Fields:** Bilingual names/descriptions, calculated pricing
**Status:** ✅ Service created (comboService.js)

---

### 5. **currencies**
```sql
CREATE TABLE public.currencies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code text NOT NULL UNIQUE,
  name_es text NOT NULL,
  name_en text NOT NULL,
  symbol text NOT NULL,
  is_base boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Multi-currency support (USD, EUR, CUP)
**Key Fields:** Bilingual names, currency codes
**Status:** ✅ Service created (currencyService.js)

---

### 6. **exchange_rates**
```sql
CREATE TABLE public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_currency_id uuid NOT NULL REFERENCES currencies(id),
  to_currency_id uuid NOT NULL REFERENCES currencies(id),
  rate numeric NOT NULL,
  is_active boolean DEFAULT true,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Currency conversion rates
**Relationships:** → currencies

---

### 7. **inventory** ⚠️ Updated 2025-10-03
```sql
CREATE TABLE public.inventory (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id uuid NOT NULL REFERENCES products(id),
  batch_number text,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved_quantity integer DEFAULT 0 CHECK (reserved_quantity >= 0),
  available_quantity integer GENERATED AS (quantity - reserved_quantity) STORED,
  cost_per_unit numeric,
  expiry_date date,
  received_date date DEFAULT CURRENT_DATE,
  supplier_reference text,
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Product stock management
**Relationships:** → products
**RLS Policies:** ✅ Fixed 2025-10-03 (see fix_inventory_rls.sql)
- `inventory_viewable_by_everyone` - Public can view active inventory
- `inventory_insertable_by_admins` - Admins can insert
- `inventory_updatable_by_admins` - Admins can update
- `inventory_deletable_by_admins` - Admins can delete

---

### 8. **inventory_movements**
```sql
CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  inventory_id uuid NOT NULL REFERENCES inventory(id),
  movement_type text NOT NULL,
  quantity_change integer NOT NULL,
  reference_id uuid,
  reference_type text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);
```
**Purpose:** Inventory transaction log
**Relationships:** → inventory, → auth.users

---

### 9. **products** ⚠️ Updated 2025-10-03 (Session 8)
```sql
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku text NOT NULL UNIQUE,
  name_es text NOT NULL,
  name_en text NOT NULL,
  description_es text,          -- ✅ Fixed: now saving bilingual descriptions
  description_en text,          -- ✅ Fixed: now saving bilingual descriptions
  category_id uuid NOT NULL REFERENCES product_categories(id),
  base_price numeric NOT NULL,
  base_currency_id uuid NOT NULL REFERENCES currencies(id),
  cost_price numeric,
  profit_margin numeric DEFAULT 40.00,
  final_price numeric GENERATED AS (base_price * (1 + profit_margin / 100)) STORED,
  weight numeric,
  dimensions jsonb,
  image_url text,
  image_file text,
  requires_expiry boolean DEFAULT false,
  min_stock_alert integer DEFAULT 10,  -- ✅ Fixed Session 8: now configurable in form
  is_active boolean DEFAULT true,
  is_featured boolean DEFAULT false,
  tags text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Product catalog
**Relationships:** → product_categories, → currencies
**Important Notes:**
- ⚠️ **NO stock field in products table** - Stock is stored in `inventory` table
- ✅ `min_stock_alert` is configurable (default: 10)
- ✅ Stock loaded from `inventory.available_quantity` when fetching products

**Recent Fixes:**
- ✅ Bilingual description fields now properly saved
- ✅ Stock now properly saved to inventory table
- ✅ Category relationship fixed
- ✅ Session 8: min_stock_alert field added to form and saves correctly
- ✅ Session 8: Category select now shows placeholder properly

---

### 10. **product_categories**
```sql
CREATE TABLE public.product_categories (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name_es text NOT NULL,
  name_en text NOT NULL,
  description_es text,
  description_en text,
  parent_id uuid REFERENCES product_categories(id),
  image_url text,
  slug text NOT NULL,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Product categorization
**Key Fields:** Bilingual names/descriptions, hierarchical structure
**Status:** ✅ CRUD fully functional

---

### 11. **testimonials** ⚠️ Schema Verified 2025-10-03
```sql
CREATE TABLE public.testimonials (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text NOT NULL,
  user_photo text,
  is_visible boolean DEFAULT false,
  is_featured boolean DEFAULT false,
  order_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Customer testimonials/reviews
**Relationships:** → auth.users
**Note:** ⚠️ Service was using non-existent fields (title, response, is_verified) - Fixed 2025-10-03
**Available Fields Only:** user_id, rating, comment, user_photo, is_visible, is_featured, order_id

---

### 12. **user_profiles**
```sql
CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  email text NOT NULL,
  role text DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  is_enabled boolean DEFAULT true,
  full_name text,
  avatar_url text,
  address text,
  city text,
  state text,
  country text,
  postal_code text,
  birth_date date,
  gender text,
  preferences jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Extended user information
**Relationships:** → auth.users
**Key Fields:** Role-based access control, user preferences

---

### 13. **orders** ⚠️ Updated 2025-10-07
```sql
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  order_type text NOT NULL,
  status text DEFAULT 'pending',
  subtotal numeric NOT NULL,
  discount_amount numeric DEFAULT 0,
  shipping_cost numeric DEFAULT 0,
  tax_amount numeric DEFAULT 0,
  total_amount numeric NOT NULL,
  currency_id uuid NOT NULL REFERENCES currencies(id),
  shipping_address jsonb,
  recipient_info jsonb,
  delivery_instructions text,
  estimated_delivery date,
  actual_delivery date,
  tracking_number text,
  payment_method text DEFAULT 'zelle',
  payment_status text DEFAULT 'pending',
  payment_reference text,
  payment_proof_url text,                           -- ✅ Added 2025-10-07: stores screenshot URL
  shipping_zone_id uuid REFERENCES shipping_zones(id), -- ✅ Added 2025-10-07: province-based shipping
  validated_by uuid REFERENCES auth.users(id),     -- ✅ Added 2025-10-07: admin who validated payment
  validated_at timestamptz,                         -- ✅ Added 2025-10-07: payment validation timestamp
  rejection_reason text,                            -- ✅ Added 2025-10-07: reason if payment rejected
  zelle_account_id uuid REFERENCES zelle_accounts(id),
  notes text,
  admin_notes text,
  offer_id uuid REFERENCES offers(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Order management
**Relationships:** → auth.users, → currencies, → zelle_accounts, → offers, → shipping_zones
**Recent Changes:**
- ✅ Added `payment_proof_url` for screenshot uploads
- ✅ Added `shipping_zone_id` for province-based shipping calculation
- ✅ Added `validated_by` to track which admin validated/rejected payment
- ✅ Added `validated_at` timestamp for validation tracking
- ✅ Added `rejection_reason` for admin to explain payment rejection

**RLS Policies:**
```sql
-- Users can view their own orders
CREATE POLICY "Users can view own orders"
ON public.orders FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- Admins can view all orders
CREATE POLICY "Admins can view all orders"
ON public.orders FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);

-- Users can create their own orders
CREATE POLICY "Users can create own orders"
ON public.orders FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- Admins can update orders (validation, status changes)
CREATE POLICY "Admins can update orders"
ON public.orders FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);
```

---

### 14. **order_items**
```sql
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES orders(id),
  item_type text NOT NULL,
  item_id uuid NOT NULL,
  item_name_es text NOT NULL,
  item_name_en text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric NOT NULL,
  total_price numeric NOT NULL,
  inventory_id uuid REFERENCES inventory(id),
  remittance_amount numeric,
  exchange_rate numeric,
  recipient_data jsonb,
  created_at timestamptz DEFAULT now()
);
```
**Purpose:** Order line items
**Relationships:** → orders, → inventory

---

### 15. **order_status_history**
```sql
CREATE TABLE public.order_status_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES orders(id),
  previous_status text,
  new_status text NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz DEFAULT now()
);
```
**Purpose:** Track order status changes over time
**Relationships:** → orders, → auth.users
**Key Fields:** Audit trail for status transitions

---

### 16. **offers**
```sql
CREATE TABLE public.offers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name_es text NOT NULL,
  name_en text NOT NULL,
  description_es text,
  description_en text,
  discount_type text NOT NULL,
  discount_value numeric NOT NULL,
  min_purchase_amount numeric,
  max_discount_amount numeric,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  applies_to text NOT NULL,
  free_shipping boolean DEFAULT false,
  shipping_discount_percent numeric DEFAULT 0,
  usage_limit integer,
  usage_count integer DEFAULT 0,
  user_usage_limit integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Promotional offers and discounts
**Key Fields:** Bilingual names/descriptions, discount configuration, usage tracking
**Status:** ⚠️ Service not yet created

---

### 17. **offer_items**
```sql
CREATE TABLE public.offer_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  offer_id uuid NOT NULL REFERENCES offers(id),
  item_type text NOT NULL,
  item_id uuid NOT NULL,
  created_at timestamptz DEFAULT now()
);
```
**Purpose:** Link offers to specific products/combos
**Relationships:** → offers

---

### 18. **remittance_services**
```sql
CREATE TABLE public.remittance_services (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name_es text NOT NULL,
  name_en text NOT NULL,
  description_es text,
  description_en text,
  source_currency_id uuid NOT NULL REFERENCES currencies(id),
  target_currency_id uuid NOT NULL REFERENCES currencies(id),
  min_amount numeric NOT NULL,
  max_amount numeric NOT NULL,
  fee_percent numeric DEFAULT 0,
  fixed_fee numeric DEFAULT 0,
  profit_margin numeric DEFAULT 40.00,
  delivery_type text NOT NULL,
  estimated_delivery_hours integer DEFAULT 24,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Money transfer/remittance services
**Relationships:** → currencies
**Key Fields:** Bilingual names, fee structure, delivery configuration
**Status:** ⚠️ Service not yet created

---

### 19. **shopping_carts**
```sql
CREATE TABLE public.shopping_carts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id),
  session_id uuid NOT NULL,
  expires_at timestamptz DEFAULT (now() + interval '30 days'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Shopping cart sessions
**Relationships:** → auth.users
**Key Fields:** Session tracking, expiration management

---

### 20. **site_visits**
```sql
CREATE TABLE public.site_visits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip_address inet,
  user_agent text,
  page_url text,
  referrer text,
  country varchar,
  city text,
  visit_date date NOT NULL DEFAULT CURRENT_DATE,
  visit_time timestamptz DEFAULT now(),
  session_id uuid,
  user_id uuid REFERENCES auth.users(id)
);
```
**Purpose:** Analytics and visitor tracking
**Relationships:** → auth.users
**Key Fields:** IP, location, page tracking

**RLS Policies:**
```sql
-- Allow admins to read visit statistics
CREATE POLICY "Allow admin read access to site_visits"
ON public.site_visits FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);

-- Allow public to log visits
CREATE POLICY "Allow insert for tracking visits"
ON public.site_visits FOR INSERT TO public
WITH CHECK (true);
```
**Status:** ✅ RLS configured (2025-10-06)

---

### 21. **system_config**
```sql
CREATE TABLE public.system_config (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key text NOT NULL UNIQUE,
  value_text text,
  value_numeric numeric,
  value_boolean boolean,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** System-wide configuration settings
**Key Fields:** Flexible value storage (text, numeric, boolean)

---

### 22. **videos**
```sql
CREATE TABLE public.videos (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title_es text NOT NULL,
  title_en text NOT NULL,
  description_es text,
  description_en text,
  video_url text NOT NULL,
  thumbnail_url text,
  platform text,
  video_id text,
  duration integer,
  is_active boolean DEFAULT true,
  category text,
  tags text[],
  view_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Video content management
**Key Fields:** Bilingual titles/descriptions, platform integration, analytics
**Status:** ⚠️ Service not yet created

---

### 23. **zelle_accounts**
```sql
CREATE TABLE public.zelle_accounts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_name text NOT NULL,
  email text NOT NULL,
  phone text,
  bank_name text,
  account_holder text,
  is_active boolean DEFAULT true,
  for_products boolean DEFAULT true,
  for_remittances boolean DEFAULT true,
  daily_limit numeric,
  monthly_limit numeric,
  current_daily_amount numeric DEFAULT 0,
  current_monthly_amount numeric DEFAULT 0,
  last_reset_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Zelle payment account management
**Key Fields:** Account details, usage limits, transaction tracking

---

### 24. **zelle_payment_stats**
```sql
CREATE TABLE public.zelle_payment_stats (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id uuid NOT NULL REFERENCES zelle_accounts(id),
  period_type text NOT NULL,
  period_start date,
  period_end date,
  payment_count integer DEFAULT 0,
  total_amount numeric DEFAULT 0,
  last_calculated timestamptz DEFAULT now()
);
```
**Purpose:** Zelle payment statistics aggregation
**Relationships:** → zelle_accounts
**Key Fields:** Period-based payment analytics

---

### 25. **notification_logs**
```sql
CREATE TABLE public.notification_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_type text NOT NULL,
  recipient text NOT NULL,
  subject text,
  content text,
  status text DEFAULT 'pending',
  reference_id uuid,
  reference_type text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```
**Purpose:** Notification delivery tracking
**Key Fields:** Type, recipient, status, error handling

---

### 26. **notification_settings**
```sql
CREATE TABLE public.notification_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  setting_type text NOT NULL UNIQUE,
  value text NOT NULL,
  is_active boolean DEFAULT true,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Notification system configuration
**Key Fields:** Setting types and values

---

### 27. **shipping_zones** ✅ New 2025-10-07
```sql
CREATE TABLE public.shipping_zones (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  province_name text NOT NULL UNIQUE,
  shipping_cost numeric NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  is_active boolean DEFAULT true,
  free_shipping boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Province-based shipping cost configuration for Cuba
**Key Fields:** Province names, shipping costs, free shipping options
**Initial Data:** Pre-populated with 16 Cuban provinces
**Status:** ✅ Created 2025-10-07, Service pending

**RLS Policies:**
```sql
-- Public can view active shipping zones
CREATE POLICY "Anyone can view active shipping zones"
ON public.shipping_zones FOR SELECT TO public
USING (is_active = true);

-- Admins can manage shipping zones
CREATE POLICY "Admins can manage shipping zones"
ON public.shipping_zones FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);
```

**Pre-populated Provinces:**
- Pinar del Río, Artemisa, La Habana, Mayabeque, Matanzas
- Cienfuegos, Villa Clara, Sancti Spíritus, Ciego de Ávila
- Camagüey, Las Tunas, Holguín, Granma, Santiago de Cuba
- Guantánamo, Isla de la Juventud

---

### 28. **system_messages** ✅ New 2025-10-07
```sql
CREATE TABLE public.system_messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_key text NOT NULL UNIQUE,
  title_es text,
  title_en text,
  content_es text NOT NULL,
  content_en text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
**Purpose:** Configurable system messages (payment instructions, announcements, etc.)
**Key Fields:** Bilingual titles/content, message keys for identification
**Initial Data:** Pre-populated with 'payment_instructions'
**Status:** ✅ Created 2025-10-07, Service pending

**RLS Policies:**
```sql
-- Public can view active system messages
CREATE POLICY "Anyone can view active system messages"
ON public.system_messages FOR SELECT TO public
USING (is_active = true);

-- Admins can manage system messages
CREATE POLICY "Admins can manage system messages"
ON public.system_messages FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);
```

**Initial Message Keys:**
- `payment_instructions` - Zelle payment information shown during checkout

---

## 🔐 RLS Policies Summary

### Recently Fixed/Added (2025-10-03):

#### Inventory Table
- ✅ `inventory_viewable_by_everyone` - Public SELECT for active items
- ✅ `inventory_insertable_by_admins` - Admin INSERT
- ✅ `inventory_updatable_by_admins` - Admin UPDATE
- ✅ `inventory_deletable_by_admins` - Admin DELETE

---

## 🔄 Recent Schema Changes

### 2025-10-07

#### Migration: orders_payment_system.sql
**Impact:** Complete e-commerce checkout and payment validation system

**New Tables:**
1. **shipping_zones** - Province-based shipping cost configuration
   - 16 Cuban provinces pre-populated
   - Configurable costs and free shipping options
   - RLS policies for public read, admin write

2. **system_messages** - Configurable bilingual system messages
   - Pre-populated with payment instructions
   - Message key system for easy retrieval
   - Admin-only write access

**Updated Tables:**
3. **orders** - Added 5 new columns:
   - `payment_proof_url` - Screenshot storage
   - `shipping_zone_id` - Links to shipping_zones
   - `validated_by` - Admin who validated/rejected
   - `validated_at` - Validation timestamp
   - `rejection_reason` - Admin's rejection explanation

**New RLS Policies:**
- Orders: Users can view/create own, admins can view/update all
- Shipping zones: Public read active zones, admins manage all
- System messages: Public read active messages, admins manage all

**New Helper Functions:**
- `get_pending_orders_count()` - Returns count of pending orders/payments
- `get_low_stock_products_count()` - Returns count of products below min_stock_alert

### 2025-10-06

#### Visual Settings Enhancement
1. **Appearance Customization** - Added to SettingsPage:
   - Company logo upload (PNG/SVG/WebP support)
   - Company name configuration
   - Header color customization (background + text)
   - Real-time previews with debouncing (800ms)
   - Applied throughout Header and App.jsx

2. **Carousel Slides** - Moved from localStorage to database:
   - HomePage now loads from `carousel_slides` table
   - Graceful fallback when no slides exist
   - Full bilingual support

3. **site_visits RLS** - Fixed 400 errors:
   - Added policies for admin read access
   - Public insert for visit tracking
   - Corrected policy to use `user_profiles` table

### 2025-10-03

#### Session 7 (Night) - Service Layer Fixes
1. **Inventory Table Operations** - Fixed query patterns:
   - Removed invalid `upsert` with `onConflict: 'product_id'` (no unique constraint)
   - Changed to query-then-update/insert pattern
   - Fixed `.single()` error when 0 rows returned (PGRST116)
   - Impact: Stock updates now work reliably

#### Session 4 (Evening) - RLS & Stock Fixes
1. **Inventory RLS Policies** - Created comprehensive policies to fix 403 errors
2. **Products Service** - Fixed to properly save:
   - `description_es` and `description_en` (was using single `description`)
   - Stock to inventory table with proper error handling
   - Category relationships

#### Session 3 (Evening) - Schema Alignment
1. **Testimonials Service** - Aligned with actual schema (removed non-existent fields)

---

## 📋 Field Naming Conventions

### Bilingual Fields
- `name_es` / `name_en` - Names
- `description_es` / `description_en` - Descriptions
- `title_es` / `title_en` - Titles

### Common Fields
- `id` - UUID primary key
- `is_active` - Soft delete flag
- `is_featured` - Featured/highlighted flag
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp
- `slug` - URL-friendly identifier

### Relationships
- `*_id` - Foreign key references
- Examples: `user_id`, `product_id`, `category_id`

---

## 🚨 Important Notes

### Data Types
- **UUID** - Used for all IDs (not auto-increment integers)
- **text** - Variable length strings
- **numeric** - Decimal numbers for prices/amounts
- **jsonb** - Structured JSON data
- **timestamptz** - Timestamps with timezone

### Constraints
- All prices: `CHECK (price >= 0)`
- Quantities: `CHECK (quantity > 0)`
- Ratings: `CHECK (rating >= 1 AND rating <= 5)`
- Roles: `CHECK (role IN ('user', 'admin', 'super_admin'))`

### Generated/Computed Fields
- `final_price` in products - Calculated from base_price + profit_margin
- `final_price` in combos - Calculated from base_total_price + profit_margin
- `available_quantity` in inventory - Calculated from quantity - reserved_quantity

---

## 📝 Next Steps / Pending

### Recommended Schema Additions:
1. Add indexes for frequently queried fields
2. Consider adding `updated_by` UUID fields for audit trails
3. Add full-text search indexes for product/category names

### Tables With Services Pending:
- `videos` - Service not yet created
- `offers` - Service not yet created
- `offer_items` - Service not yet created
- `remittance_services` - Service not yet created
- `order_status_history` - Service not yet created
- `shopping_carts` - Service not yet created
- `cart_items` - Service not yet created
- `site_visits` - Service not yet created (analytics)
- `system_config` - Service not yet created
- `zelle_accounts` - Service not yet created
- `zelle_payment_stats` - Service not yet created
- `notification_logs` - Service not yet created
- `notification_settings` - Service not yet created
- ⏳ `shipping_zones` - Service pending (shippingService.js)
- ⏳ `system_messages` - Service pending (systemMessageService.js)
- ⏳ `orders` - Service pending (orderService.js) - **Priority 1**

### Tables With Complete Services:
- ✅ `products` - productService.js
- ✅ `product_categories` - productService.js
- ✅ `combo_products` - comboService.js
- ✅ `combo_items` - comboService.js
- ✅ `carousel_slides` - carouselService.js
- ✅ `testimonials` - testimonialService.js
- ✅ `currencies` - currencyService.js
- ✅ `inventory` - Basic operations in productService.js

### New Utilities:
- ✅ `styleUtils.js` - System-wide visual personalization (2025-10-07)
  - Background, card, button, heading, text, pill, status styles
  - Input, link, alert, divider styles
  - Color utilities (contrast, opacity, dark detection)

---

**Maintenance Instructions:**
- Update this file whenever schema changes are made
- Run `\d table_name` in psql to verify current structure
- Check `pg_policies` view for RLS policy verification
- Keep track of all migrations in `/supabase/migrations/`

---

**Last Schema Verification:** 2025-10-07 (Post orders_payment_system.sql execution)
**Migration Files Location:** `/supabase/migrations/`
**Latest Migration:** `20251007_orders_payment_system.sql` (✅ Executed successfully)
**Total Tables in Database:** 29
**Tables with Active Services:** 8
**Tables Pending Implementation:** 16 (3 prioritized for current sprint)
