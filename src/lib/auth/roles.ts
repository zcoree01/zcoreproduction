// System roles seeded for every organization by private.bootstrap_organization().
export const SYSTEM_ROLE_KEYS = [
  "admin",
  "director",
  "head_of_production",
  "warehouse",
  "operator",
  "quality_inspector",
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export function isSystemRoleKey(key: string): key is SystemRoleKey {
  return (SYSTEM_ROLE_KEYS as readonly string[]).includes(key);
}
