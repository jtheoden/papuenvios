/**
 * Classification of public catalog load failures.
 *
 * parseSupabaseError wraps a Postgres 42501 (permission denied) into a generic AppError and
 * keeps the original code under context, so the code can live in several places.
 */

const PERMISSION_DENIED = '42501';

export const isPermissionDeniedError = (error) => {
  if (!error) return false;
  return [
    error.code,
    error.context?.postgresCode,
    error.context?.originalError?.code
  ].some((code) => String(code) === PERMISSION_DENIED);
};

/** @returns {'permission'|'load'} */
export const classifyCatalogError = (error) =>
  isPermissionDeniedError(error) ? 'permission' : 'load';
