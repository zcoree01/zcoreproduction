import { describe, expect, it } from "vitest";
import {
  activationSchema,
  badgePayload,
  decodeDevice,
  encodeDevice,
  kioskClockSchema,
  parseBadge,
  pinSchema,
  weakPin,
} from "./kiosk-rules";

const token = "0123456789abcdef01234567";

describe("badges", () => {
  it("reads the token from a QR / NFC / keyboard-scanner text", () => {
    expect(parseBadge(badgePayload(token))).toBe(token);
    expect(parseBadge(` ${token.toUpperCase()}\n`)).toBe(token);
    expect(parseBadge("zcore-kiosk:123")).toBeNull();
    expect(parseBadge("https://example.com")).toBeNull();
  });
});

describe("PIN", () => {
  it("is four digits and rejects easy ones", () => {
    expect(pinSchema.safeParse("4821").success).toBe(true);
    expect(pinSchema.safeParse("482").success).toBe(false);
    expect(pinSchema.safeParse("48a1").success).toBe(false);
    expect(weakPin("1111")).toBe(true);
    expect(weakPin("1234")).toBe(true);
    expect(weakPin("8901")).toBe(true);
    expect(weakPin("4321")).toBe(true);
    expect(weakPin("4821")).toBe(false);
  });
});

describe("device cookie", () => {
  it("round-trips and rejects anything else", () => {
    const id = "3f2b5c3e-8c7a-4c55-9a41-2f1d5e6b7a80";
    const secret = "a".repeat(64);
    expect(decodeDevice(encodeDevice(id, secret))).toEqual({ kioskId: id, secret });
    expect(decodeDevice(undefined)).toBeNull();
    expect(decodeDevice(`${id}.short`)).toBeNull();
    expect(decodeDevice(`not-a-uuid.${secret}`)).toBeNull();
  });
});

describe("schemas", () => {
  it("normalises activation codes and validates clock requests", () => {
    expect(activationSchema.parse({ code: " ab3k7mpq " }).code).toBe("AB3K7MPQ");
    expect(activationSchema.safeParse({ code: "AB0K7MPQ" }).success).toBe(false);
    expect(
      kioskClockSchema.safeParse({
        method: "badge",
        badge: token,
        idempotencyKey: crypto.randomUUID(),
      }).success,
    ).toBe(true);
    expect(kioskClockSchema.safeParse({ method: "pin", pin: "1234" }).success).toBe(false);
  });
});
