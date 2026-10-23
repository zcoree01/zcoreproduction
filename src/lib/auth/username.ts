import { z } from "zod";

// Must match the CHECK constraints in supabase/migrations/*_foundation_schema.sql
// and the e-mail check in private.handle_new_auth_user().
export const AUTH_EMAIL_DOMAIN = "users.zcore.ba";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/);

export const orgSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);

// Workers sign in with a username; Supabase Auth needs an e-mail.
export function toAuthEmail(username: string, orgSlug: string): string {
  return `${usernameSchema.parse(username)}@${orgSlugSchema.parse(orgSlug)}.${AUTH_EMAIL_DOMAIN}`;
}
