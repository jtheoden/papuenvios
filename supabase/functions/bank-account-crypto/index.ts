import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ENCRYPTION_KEY = Deno.env.get('BANK_ENCRYPTION_KEY') ?? ''
const SALT = 'papuenvios-bank-v2'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://www.papuenvios.com'
const corsHeaders = {
  'Access-Control-Allow-Origin': APP_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

async function encryptValue(plaintext: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await getDerivedKey(ENCRYPTION_KEY, SALT)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext))
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.length)
  return btoa(String.fromCharCode(...combined))
}

async function decryptValue(encryptedBase64: string): Promise<string> {
  const decoder = new TextDecoder()
  const key = await getDerivedKey(ENCRYPTION_KEY, SALT)
  const combined = new Uint8Array(atob(encryptedBase64).split('').map((c) => c.charCodeAt(0)))
  const iv = combined.slice(0, 12)
  const encrypted = combined.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)
  return decoder.decode(decrypted)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
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
    if (!data) return json({ error: 'Missing data' }, 400)

    if (action === 'encrypt') {
      const encrypted = await encryptValue(data)
      return json({ encrypted })
    }

    if (action === 'decrypt') {
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profileError || !profile || !['admin', 'super_admin'].includes(profile.role)) {
        return json({ error: 'Forbidden' }, 403)
      }

      const decrypted = await decryptValue(data)
      return json({ decrypted })
    }

    return json({ error: 'Invalid action' }, 400)
  } catch (err) {
    console.error('[bank-account-crypto]', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
