import { describe, expect, it } from "vitest";
import { usernameSchema } from "@/lib/auth/username";
import { generateTempPassword, TEMP_PASSWORD_WORDS } from "./temp-password";
import {
  normalizeNamePart,
  pickUsername,
  splitFullName,
  usernameCandidates,
} from "./username-suggest";

describe("normalizeNamePart", () => {
  it("removes diacritics, spaces and punctuation", () => {
    expect(normalizeNamePart("Đurić-Šehić")).toBe("djuricsehic");
    expect(normalizeNamePart("Čolaković Ćatić Žepa")).toBe("colakoviccaticzepa");
    expect(normalizeNamePart("O'Brien")).toBe("obrien");
  });
});

describe("splitFullName", () => {
  it("uses the first and the last word", () => {
    expect(splitFullName(" Ana  Marija Kovač ")).toEqual({ firstName: "Ana", lastName: "Kovač" });
    expect(splitFullName("Ana")).toEqual({ firstName: "Ana", lastName: "" });
  });
});

describe("usernameCandidates", () => {
  it("adds letters of the last name, then numbers", () => {
    const candidates = usernameCandidates("Mirza", "Zebić");
    expect(candidates.slice(0, 6)).toEqual([
      "mirza.z",
      "mirza.ze",
      "mirza.zeb",
      "mirza.zebi",
      "mirza.zebic",
      "mirza.zebic2",
    ]);
  });

  it("works without a last name and for very short names", () => {
    expect(usernameCandidates("Al", "").slice(0, 2)).toEqual(["al2", "al3"]);
    expect(usernameCandidates("", "Hodžić")[0]).toBe("hodzic");
    expect(usernameCandidates("", "")[0]).toBe("korisnik");
  });

  it("only returns valid usernames of at most 32 characters", () => {
    const long = usernameCandidates("Maksimilijanaaaaaaaa", "Kovačevićbegovićhadžimuratović");
    for (const candidate of long) {
      expect(usernameSchema.safeParse(candidate).success).toBe(true);
      expect(candidate.length).toBeLessThanOrEqual(32);
    }
  });
});

describe("pickUsername", () => {
  it("returns the first free candidate", () => {
    expect(pickUsername(["a.b", "a.bc"], new Set(["a.b"]))).toBe("a.bc");
    expect(pickUsername(["a.b"], new Set(["a.b"]))).toBeNull();
  });
});

describe("generateTempPassword", () => {
  it("is a simple word followed by three digits without 0 and 1", () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTempPassword();
      const match = /^([a-z]+)([2-9]{3})$/.exec(password);
      expect(match).not.toBeNull();
      expect(TEMP_PASSWORD_WORDS).toContain(match?.[1]);
      expect(password.length).toBeGreaterThanOrEqual(8);
    }
  });
});
