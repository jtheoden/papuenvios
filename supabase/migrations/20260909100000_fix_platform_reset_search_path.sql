-- FIX: execute_platform_reset() corre con SET search_path = public (sin
-- extensions), pero su INSERT final en admin_destructive_ops_log usa
-- DEFAULT uuid_generate_v4() para la PK, y uuid_generate_v4() vive en el
-- schema extensions (verificado via pg_proc/pg_namespace en la BD remota),
-- no en public. Con el search_path acotado, ese INSERT final falla despues
-- de que TODOS los DELETE/UPDATE de la funcion ya corrieron -> como todo el
-- cuerpo es una unica transaccion implicita de PL/pgSQL, el error revierte
-- el reset completo, pero el usuario ve una falla generica sin poder saber
-- que la causa fue el schema faltante.
--
-- Fix: agregar extensions al search_path de la funcion, sin tocar el resto
-- de la logica (mismo patron que otras funciones SECURITY DEFINER de la
-- migracion 20260808000002 no necesitan porque no usan uuid_generate_v4()).

ALTER FUNCTION public.execute_platform_reset(text)
  SET search_path = public, extensions;
