import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const NOTIFICATION_KEYS = {
  whatsapp: "whatsapp_admin_phone",
  whatsappGroup: "whatsapp_group",
  adminEmail: "admin_email",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase configuration. Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      headers: {
        Authorization: req.headers.get("Authorization") ?? "",
      },
    },
  });

  try {
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return json({ message: "No se pudo validar la sesión. Vuelve a iniciar sesión." }, 401);
    }

    const isAdmin = await checkIsAdmin(supabase, user.id);
    if (!isAdmin) {
      return json({ message: "Solo los administradores pueden gestionar estas configuraciones." }, 403);
    }

    if (req.method === "GET") {
      return await handleGetSettings(supabase);
    }

    if (req.method === "PUT") {
      const payload = await req.json().catch(() => null);
      return await handleUpdateSettings(supabase, payload);
    }

    return json({ message: "Método no permitido" }, 405);
  } catch (err) {
    console.error("[notification-settings] Unexpected error", err);
    return json({ message: "Ocurrió un error inesperado al procesar la solicitud." }, 500);
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
    .eq("user_id", userId)
    .single();

  if (error) {
    console.error("[notification-settings] Error checking admin role", error);
    return false;
  }

  return data?.role === "admin" || data?.role === "super_admin";
}

async function handleGetSettings(supabaseClient: ReturnType<typeof createClient>) {
  const { data, error } = await supabaseClient
    .from("system_config")
    .select("key, value_text")
    .in("key", Object.values(NOTIFICATION_KEYS));

  if (error) {
    console.error("[notification-settings] Error loading settings", error);
    return json({ message: "No se pudieron cargar las configuraciones." }, 500);
  }

  if (!data || data.length !== Object.keys(NOTIFICATION_KEYS).length) {
    console.error("[notification-settings] Missing notification config keys", data);
    return json({ message: "Faltan configuraciones de notificaciones. Ejecuta la migración o inicializa los valores en system_config." }, 500);
  }

  const settings = {
    whatsapp: data.find((item) => item.key === NOTIFICATION_KEYS.whatsapp)?.value_text || "",
    whatsappGroup: data.find((item) => item.key === NOTIFICATION_KEYS.whatsappGroup)?.value_text || "",
    adminEmail: data.find((item) => item.key === NOTIFICATION_KEYS.adminEmail)?.value_text || "",
  };

  return json(settings);
}

async function handleUpdateSettings(supabaseClient: ReturnType<typeof createClient>, payload: any) {
  if (!payload || typeof payload !== "object") {
    return json({ message: "El cuerpo de la solicitud es inválido." }, 400);
  }

  const updates = [
    { key: NOTIFICATION_KEYS.whatsapp, value: payload.whatsapp ?? "" },
    { key: NOTIFICATION_KEYS.whatsappGroup, value: payload.whatsappGroup ?? "" },
    { key: NOTIFICATION_KEYS.adminEmail, value: payload.adminEmail ?? "" },
  ];

  const { data: existingKeys, error: existingError } = await supabaseClient
    .from("system_config")
    .select("key")
    .in("key", Object.values(NOTIFICATION_KEYS));

  if (existingError) {
    console.error("[notification-settings] Error verifying existing keys", existingError);
    return json({ message: "No se pudieron verificar las configuraciones actuales." }, 500);
  }

  const existingKeySet = new Set(existingKeys?.map((item) => item.key));
  const missingKeys = updates.filter((item) => !existingKeySet.has(item.key)).map((item) => item.key);
  if (missingKeys.length > 0) {
    console.error("[notification-settings] Missing configuration keys", missingKeys);
    return json({
      message: "Faltan llaves de configuración. Ejecuta las migraciones o crea las entradas requeridas en system_config.",
      missingKeys,
    }, 500);
  }

  for (const update of updates) {
    const { error } = await supabaseClient
      .from("system_config")
      .update({ value_text: String(update.value ?? ""), updated_at: new Date().toISOString() })
      .eq("key", update.key);

    if (error) {
      console.error(`[notification-settings] Error updating ${update.key}`, error);
      return json({ message: "No se pudieron guardar las configuraciones." }, 500);
    }
  }

  return json({ message: "Configuraciones actualizadas correctamente." });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
