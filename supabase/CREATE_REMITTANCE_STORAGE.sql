-- ============================================================================
-- CREAR BUCKET Y POLÍTICAS PARA COMPROBANTES DE REMESAS
-- ============================================================================

-- Crear bucket para comprobantes de pago de remesas
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'remittance-proofs',
  'remittance-proofs',
  false,  -- Privado (solo usuarios autenticados)
  5242880,  -- 5MB límite
  ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- POLÍTICAS RLS PARA EL BUCKET
-- ============================================================================

-- Política 1: Los usuarios pueden subir SUS comprobantes
CREATE POLICY "Users can upload own payment proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'remittance-proofs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Política 2: Los usuarios pueden ver SUS comprobantes
CREATE POLICY "Users can view own payment proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'remittance-proofs'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  )
);

-- Política 3: Los admins pueden ver TODOS los comprobantes
CREATE POLICY "Admins can view all payment proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'remittance-proofs'
  AND EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.user_id = auth.uid()
    AND user_profiles.role IN ('admin', 'super_admin')
  )
);

-- Política 4: Los usuarios pueden actualizar SUS comprobantes
CREATE POLICY "Users can update own payment proofs"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'remittance-proofs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Política 5: Los usuarios pueden eliminar SUS comprobantes
CREATE POLICY "Users can delete own payment proofs"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'remittance-proofs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Verificar
SELECT
  '✅ BUCKET CREADO' as status,
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
WHERE id = 'remittance-proofs';
