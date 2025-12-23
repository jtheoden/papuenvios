# Configurar Google OAuth con Supabase y Vercel

Sigue estos pasos para que el login con Google funcione en producción y evitar errores 404 en el callback.

## 1) No subas el client secret al repositorio
- El archivo `client_secret_*.json` **no debe estar en git**. Si ya estuvo versionado, rota el secreto en Google Cloud Console (OAuth consent → Credentials → regenerate client secret).

## 2) Configura el OAuth client en Google Cloud
- Tipo de aplicación: **Web application**.
- **Authorized JavaScript origins**:
  - `https://papuenvios.vercel.app`
  - `https://papuenvios-e030m2htq.vercel.app` (dominio preview de Vercel, ajusta si cambia)
  - `http://localhost:5173` (para desarrollo local)
- **Authorized redirect URIs**:
  - `https://papuenvios.vercel.app/auth/callback`
  - `https://papuenvios-e030m2htq.vercel.app/auth/callback` (preview)
  - `http://localhost:5173/auth/callback` (local)

> Si usas otro dominio custom, agrégalo en Origins y Redirects con y sin `www` solo si realmente sirve con ese host.

## 3) Configura Supabase Auth
- Supabase → Authentication → URL configuration:
  - **Site URL**: `https://papuenvios.vercel.app`
  - **Redirect URLs**: agrega las tres anteriores (prod, preview, local).

## 4) Variables de entorno
Define en Vercel (Project Settings → Environment Variables) y en `.env.local` para desarrollo:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GOOGLE_CLIENT_ID=345880876329-hgq62oc3tj8cbfjgv2ds099q4edu5u4u.apps.googleusercontent.com
```
> **No** expongas `VITE_GOOGLE_CLIENT_SECRET` en el frontend; Supabase solo necesita el Client ID en el cliente. El secreto se guarda en Google y no se usa en el bundle.

## 5) Reescritura SPA en Vercel
- Ya se incluyó `vercel.json` con rewrite `/(.*) -> /index.html` para que `/auth/callback` no devuelva 404 en producción.

## 6) Probar el flujo
- Local: `npm install && npm run dev`, luego inicia sesión con Google desde `http://localhost:5173`.
- Producción: redeploy en Vercel tras ajustar las variables y la configuración de Supabase/Google.
