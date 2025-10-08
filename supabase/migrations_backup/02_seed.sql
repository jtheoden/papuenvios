-- Seed initial data
DO $$ 
BEGIN
    -- Clean up existing test data if exists
    DELETE FROM auth.users WHERE email IN (
        'superadmin@test.com',
        'admin@test.com',
        'user@test.com',
        'jtheoden@gmail.com'
    );

    -- Insert base currency
    INSERT INTO public.currencies (
        code,
        name_es,
        name_en,
        symbol,
        is_base,
        is_active,
        exchange_rate
    )
    VALUES
        ('USD', 'Dólar Estadounidense', 'US Dollar', '$', true, true, 1),
        ('VES', 'Bolívar', 'Venezuelan Bolivar', 'Bs.', false, true, null)
    ON CONFLICT (code) DO NOTHING;

    -- Insert test users with proper password hashing
    INSERT INTO auth.users (
        id,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_user_meta_data,
        is_sso_user,
        created_at,
        updated_at,
        phone,
        phone_confirmed_at
    )
    VALUES 
        (
            '00000000-0000-0000-0000-000000000001',
            'superadmin@test.com',
            crypt('test123', gen_salt('bf')),
            NOW(),
            jsonb_build_object(
                'full_name', 'Super Admin',
                'avatar_url', 'https://api.dicebear.com/7.x/avataaars/svg?seed=superadmin'
            ),
            false,
            NOW(),
            NOW(),
            NULL,
            NULL
        ),
        (
            '00000000-0000-0000-0000-000000000002',
            'admin@test.com',
            crypt('test123', gen_salt('bf')),
            NOW(),
            jsonb_build_object(
                'full_name', 'Admin User',
                'avatar_url', 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin'
            ),
            false,
            NOW(),
            NOW(),
            NULL,
            NULL
        ),
        (
            '00000000-0000-0000-0000-000000000003',
            'user@test.com',
            crypt('test123', gen_salt('bf')),
            NOW(),
            jsonb_build_object(
                'full_name', 'Regular User',
                'avatar_url', 'https://api.dicebear.com/7.x/avataaars/svg?seed=user'
            ),
            false,
            NOW(),
            NOW(),
            NULL,
            NULL
        )
    ON CONFLICT (id) DO NOTHING;

    -- Insert base categories
    INSERT INTO public.product_categories (
        name_es,
        name_en,
        slug,
        description_es,
        description_en,
        is_active,
        display_order
    )
    VALUES
        (
            'General',
            'General',
            'general',
            'Categoría general para productos',
            'General category for products',
            true,
            0
        )
    ON CONFLICT (slug) DO NOTHING;

END $$;