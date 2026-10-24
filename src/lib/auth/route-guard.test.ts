import { describe, expect, it } from "vitest";
import { decideRoute } from "./route-guard";

describe("decideRoute", () => {
  it("lets an active session through and keeps it off /login", () => {
    expect(decideRoute({ path: "/machines", signedInHere: true, sessionActive: true })).toEqual({
      action: "next",
    });
    expect(decideRoute({ path: "/login", signedInHere: true, sessionActive: true })).toEqual({
      action: "redirect",
      to: "/",
    });
  });

  it("sends anonymous visitors of protected pages to /login", () => {
    expect(decideRoute({ path: "/floor", signedInHere: false, sessionActive: false })).toEqual({
      action: "redirect",
      to: "/login",
    });
    expect(decideRoute({ path: "/login", signedInHere: false, sessionActive: false })).toEqual({
      action: "next",
    });
  });

  it("signs out a session replaced by a sign-in on another device, on any path", () => {
    for (const path of ["/floor", "/login", "/machines"]) {
      expect(decideRoute({ path, signedInHere: true, sessionActive: false })).toEqual({
        action: "sign_out",
        to: "/login",
      });
    }
  });
});
