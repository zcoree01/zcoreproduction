// System roles seeded for every organization by private.bootstrap_organization().
export const SYSTEM_ROLE_KEYS = [
  "admin",
  "director",
  "head_of_production",
  "warehouse",
  "operator",
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];
