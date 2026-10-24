// Generated types describe Postgres `numeric` columns as `number`, but writing
// them as JS numbers would go through floating point. PostgREST accepts the
// decimal string ("12.5") for numeric columns and stores it exactly, so writes
// pass canonical decimal strings (lib/decimal) through this one typed cast.
export function numericParam(value: string): number;
export function numericParam(value: string | null): number | null;
export function numericParam(value: string | null): number | null {
  return value as unknown as number | null;
}

// Generated RPC argument types are never nullable, but SQL functions receive
// null for an omitted value (e.g. "create" instead of "update"). This cast
// states that intent in one place.
export function nullableParam<T>(value: T | null): T {
  return value as T;
}
