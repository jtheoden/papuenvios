import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { buildCorsHeaders } from '../_shared/cors.ts'
import { authorizeRequest, resolveEncryptionKey, validatePayload } from './logic.js'

// DEBT: fixed salt, kept because changing it would invalidate every stored ciphertext.
// Migration path: version the ciphertext (prefix "v2:" + per-record random salt), decrypt
// legacy values with this salt and re-encrypt lazily. Not implemented here on purpose.
const SALT = 'papuenvios-bank-v2'
// Fail closed: no secret -> no encryption (resolved per request, see resolveEncryptionKey).
const ENCRYPTION_KEY_RAW = Deno.env.get('BANK_ENCRYPTION_KEY')

async function getDerivedKey(keyString: string, salt: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(keyString),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptValue(plaintext: string, keyString: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await getDerivedKey(keyString, SALT)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext))
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.length)
  return btoa(String.fromCharCode(...combined))
}

async function decryptValue(encryptedBase64: string, keyString: string): Promise<string> {
  const decoder = new TextDecoder()
  const key = await getDerivedKey(keyString, SALT)
  const combined = new Uint8Array(atob(encryptedBase64).split('').map((c) => c.charCodeAt(0)))
  const iv = combined.slice(0, 12)
  const encrypted = combined.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)
  return decoder.decode(decrypted)
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const keyResult = resolveEncryptionKey(ENCRYPTION_KEY_RAW)
    if (!keyResult.ok) {
      console.error('[bank-account-crypto] BANK_ENCRYPTION_KEY is not configured')
      return json({ error: keyResult.error }, keyResult.status)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { action, data } = await req.json()

    // Role is only needed (and only fetched) for decrypt.
    let role: string | null = null
    if (action === 'decrypt') {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      role = profile?.role ?? null
    }

    const authz = authorizeRequest({ action, hasSession: true, role })
    if (!authz.ok) return json({ error: authz.error }, authz.status)

    const payload = validatePayload(action, data)
    if (!payload.ok) return json({ error: payload.error }, payload.status)

    if (action === 'encrypt') {
      return json({ encrypted: await encryptValue(data, keyResult.key) })
    }
    return json({ decrypted: await decryptValue(data, keyResult.key) })
  } catch (err) {
    console.error('[bank-account-crypto]', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
