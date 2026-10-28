import { z } from "zod";

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

/** Device cookie value "<kiosk id>.<secret>". */
export function encodeDevice(kioskId: string, secret: string): string {
  return `${kioskId}.${secret}`;
}

export function decodeDevice(
  value: string | undefined,
): { kioskId: string; secret: string } | null {
  if (!value) return null;
  const [kioskId = "", secret = ""] = value.split(".");
  if (!z.uuid().safeParse(kioskId).success || !/^[a-f0-9]{64}$/.test(secret)) return null;
  return { kioskId, secret };
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
export type KioskError = (typeof KIOSK_ERRORS)[number] | "invalid" | "unexpected";
