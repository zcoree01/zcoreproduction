import { z } from "zod";
import { orgSlugSchema } from "@/lib/auth/username";

// Kiosk (shared tablet) rules: badge payloads, PINs, the device cookie
// (pure, unit-tested). A badge carries a random 24-hex token, printed as a QR
// code ("zcore-kiosk:<token>") or written to an NFC tag; scanners that type
// the text work as well.

export const KIOSK_COOKIE = "zcore_kiosk";
export const BADGE_PREFIX = "zcore-kiosk:";
const TOKEN = /^[a-f0-9]{24}$/;

/** The badge token from a scanned text (QR, NFC, keyboard scanner), or null. */
export function parseBadge(text: string): string | null {
  const value = text.trim().toLowerCase();
  const token = value.startsWith(BADGE_PREFIX) ? value.slice(BADGE_PREFIX.length) : value;
  return TOKEN.test(token) ? token : null;
}

export function badgePayload(token: string): string {
  return `${BADGE_PREFIX}${token}`;
}

export const pinSchema = z.string().regex(/^\d{4}$/);

/** PINs that are too easy to guess. */
export function weakPin(pin: string): boolean {
  if (/^(\d)\1{3}$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const ascending = digits.every(
    (digit, index) => index === 0 || digit === (digits[index - 1]! + 1) % 10,
  );
  const descending = digits.every(
    (digit, index) => index === 0 || digit === (digits[index - 1]! + 9) % 10,
  );
  return ascending || descending;
}

export type DeviceCookie = { slug: string | null; kioskId: string; secret: string };

/**
 * Device cookie value "<org slug>.<kiosk id>.<secret>". The slug lets
 * kiosk.zcore.ba (no tenant in the host) find the company; the database
 * still checks it together with the secret (D-048).
 */
export function encodeDevice(device: { slug: string; kioskId: string; secret: string }): string {
  return `${device.slug}.${device.kioskId}.${device.secret}`;
}

/** Reads the cookie; the older "<kiosk id>.<secret>" form has no slug. */
export function decodeDevice(value: string | undefined): DeviceCookie | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const [kioskId = "", secret = ""] = parts.slice(-2);
  if (!z.uuid().safeParse(kioskId).success || !/^[a-f0-9]{64}$/.test(secret)) return null;
  if (parts.length === 2) return { slug: null, kioskId, secret };
  const slug = orgSlugSchema.safeParse(parts[0]);
  return slug.success && slug.data === parts[0] ? { slug: slug.data, kioskId, secret } : null;
}

/**
 * Company of a kiosk request: the host's tenant on <slug>.zcore.ba (a cookie
 * of another company does not count there), the cookie's slug on hosts
 * without a tenant (kiosk.zcore.ba).
 */
export function deviceSlug(hostSlug: string | null, cookieSlug: string | null): string | null {
  if (hostSlug) return cookieSlug === null || cookieSlug === hostSlug ? hostSlug : null;
  return cookieSlug;
}

export const activationSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NP-Z2-9]{8}$/),
});

export const kioskClockSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("badge"), badge: z.string().max(200), idempotencyKey: z.uuid() }),
  z.object({
    method: z.literal("pin"),
    employeeId: z.uuid(),
    pin: z.string().max(10),
    idempotencyKey: z.uuid(),
  }),
]);

export const KIOSK_ERRORS = [
  "invalid_code",
  "kiosk_unknown",
  "badge_unknown",
  "pin_not_set",
  "pin_wrong",
  "pin_locked",
  "module_disabled",
  "not_an_employee",
] as const;
export type KioskError = (typeof KIOSK_ERRORS)[number] | "invalid" | "unexpected" | "rate_limited";

/** Pause after a badge scan: further scans are ignored for this long. */
export const SCAN_COOLDOWN_MS = 3000;

/** Whether a scan at `now` is accepted after the last accepted one (ms timestamps). */
export function acceptScan(
  now: number,
  lastAccepted: number | null,
  cooldownMs = SCAN_COOLDOWN_MS,
): boolean {
  return lastAccepted === null || now - lastAccepted >= cooldownMs || now < lastAccepted;
}
