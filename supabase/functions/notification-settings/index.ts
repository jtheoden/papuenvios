import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Keys map frontend names to database setting_type values
const NOTIFICATION_KEYS = {
  whatsapp: "whatsapp_admin_phone",
  whatsappGroup: "whatsapp_group",
  adminEmail: "admin_email",
  whatsappTarget: "whatsapp_target",
};

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, prefer",
    "Access-Control-Max-Age": "86400",
    ...(origin !== "*" ? { Vary: "Origin" } : {}),
  };
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase configuration. Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.");
}

serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  // Use service role key for database operations to bypass RLS
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      headers: {
        Authorization: req.headers.get("Authorization") ?? "",
      },
    },
  });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ message: "Faltan las variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY" }, 500, corsHeaders);
    }

    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return json({ message: "No se pudo validar la sesión. Vuelve a iniciar sesión." }, 401, corsHeaders);
    }

    // GET: Todos los usuarios autenticados pueden leer las configuraciones
    if (req.method === "GET") {
      return await handleGetSettings(supabase, corsHeaders);
    }

    // PUT: Solo admins pueden modificar las configuraciones
    if (req.method === "PUT") {
      const isAdmin = await checkIsAdmin(supabase, user.id);
      if (!isAdmin) {
        return json({ message: "Solo los administradores pueden modificar estas configuraciones." }, 403, corsHeaders);
      }
      const payload = await req.json().catch(() => null);
      return await handleUpdateSettings(supabase, payload, corsHeaders);
    }

    return json({ message: "Método no permitido" }, 405, corsHeaders);
  } catch (err) {
    console.error("[notification-settings] Unexpected error", err);
    return json({ message: "Ocurrió un error inesperado al procesar la solicitud." }, 500, corsHeaders);
  }
});

async function getAuthenticatedUser(supabaseClient: ReturnType<typeof createClient>) {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error) {
    console.error("[notification-settings] Error fetching user", error);
    return null;
  }
  return data?.user ?? null;
}

async function checkIsAdmin(supabaseClient: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabaseClient
    .from("user_profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("[notification-settings] Error checking admin role", error);
    return false;
  }

  return data?.role === "admin" || data?.role === "super_admin";
}

async function handleGetSettings(
  supabaseClient: ReturnType<typeof createClient>,
  corsHeaders: HeadersInit,
) {
  // Read from notification_settings table (consistent with frontend)
  const { data, error } = await supabaseClient
    .from("notification_settings")
    .select("setting_type, value, is_active")
    .in("setting_type", Object.values(NOTIFICATION_KEYS));

  if (error) {
    console.error("[notification-settings] Error loading settings from notification_settings", error);
    return json({ message: "No se pudieron cargar las configuraciones." }, 500, corsHeaders);
  }

  console.log("[notification-settings] Loaded settings from notification_settings:", data);

  // Map database rows to frontend object format
  const getValue = (key: string) => {
    const row = data?.find((item: { setting_type: string }) => item.setting_type === key);
    return row?.value || "";
  };

  const settings = {
    whatsapp: getValue(NOTIFICATION_KEYS.whatsapp),
    whatsappGroup: getValue(NOTIFICATION_KEYS.whatsappGroup),
    adminEmail: getValue(NOTIFICATION_KEYS.adminEmail),
    whatsappTarget: getValue(NOTIFICATION_KEYS.whatsappTarget) || "whatsapp",
  };

  console.log("[notification-settings] Returning settings:", settings);
  return json(settings, 200, corsHeaders);
}

async function handleUpdateSettings(
  supabaseClient: ReturnType<typeof createClient>,
  payload: any,
  corsHeaders: HeadersInit,
) {
  if (!payload || typeof payload !== "object") {
    return json({ message: "El cuerpo de la solicitud es inválido." }, 400, corsHeaders);
  }

  console.log("[notification-settings] Update payload:", payload);

  const updates = [
    { setting_type: NOTIFICATION_KEYS.whatsapp, value: payload.whatsapp ?? "" },
    { setting_type: NOTIFICATION_KEYS.whatsappGroup, value: payload.whatsappGroup ?? "" },
    { setting_type: NOTIFICATION_KEYS.adminEmail, value: payload.adminEmail ?? "" },
    { setting_type: NOTIFICATION_KEYS.whatsappTarget, value: payload.whatsappTarget ?? "whatsapp" },
  ];

  // Upsert to notification_settings table (same as frontend)
  for (const update of updates) {
    const { error } = await supabaseClient
      .from("notification_settings")
      .upsert(
        {
          setting_type: update.setting_type,
          value: String(update.value ?? ""),
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_type" }
      );

    if (error) {
      console.error(`[notification-settings] Error updating ${update.setting_type}`, error);
      return json({ message: "No se pudieron guardar las configuraciones." }, 500, corsHeaders);
    }
  }

  console.log("[notification-settings] Settings updated successfully");
  return json({ message: "Configuraciones actualizadas correctamente." }, 200, corsHeaders);
}

function json(data: unknown, status = 200, corsHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
