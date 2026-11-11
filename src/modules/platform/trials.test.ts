import { describe, expect, it } from "vitest";
import { trialsEndingIds } from "./trials";

// Same rule as todo.trials_ending in public.platform_home(): a firm with an
// enabled module whose trial ends today or within the next 7 days, dates in
// the Zcore organization's timezone.

const TZ = "Europe/Sarajevo";
// 2026-11-11 10:00 in Sarajevo.
const NOW = new Date("2026-11-11T09:00:00Z");

const firm = (id: string, ...modules: { enabled?: boolean; activeUntil: string | null }[]) => ({
  id,
  modules: modules.map((m) => ({ enabled: m.enabled ?? true, activeUntil: m.activeUntil })),
});

describe("trialsEndingIds", () => {
  it("takes trials ending from today through today + 7 days", () => {
    const ids = trialsEndingIds(
      [
        firm("today", { activeUntil: "2026-11-11T20:00:00Z" }),
        firm("in7", { activeUntil: "2026-11-18T12:00:00Z" }),
        firm("in8", { activeUntil: "2026-11-19T12:00:00Z" }),
        firm("ended", { activeUntil: "2026-11-10T12:00:00Z" }),
        firm("paid", { activeUntil: null }),
      ],
      NOW,
      TZ,
    );
    expect([...ids].sort()).toEqual(["in7", "today"]);
  });

  it("uses the Zcore timezone for the end date", () => {
    // 23:30 UTC on the 18th is already the 19th in Sarajevo: outside the window.
    const ids = trialsEndingIds([firm("late", { activeUntil: "2026-11-18T23:30:00Z" })], NOW, TZ);
    expect(ids.size).toBe(0);
  });

  it("ignores disabled modules and counts a firm once", () => {
    const ids = trialsEndingIds(
      [
        firm("off", { enabled: false, activeUntil: "2026-11-12T12:00:00Z" }),
        firm(
          "two",
          { activeUntil: "2026-11-12T12:00:00Z" },
          { activeUntil: "2026-11-13T12:00:00Z" },
        ),
      ],
      NOW,
      TZ,
    );
    expect([...ids]).toEqual(["two"]);
  });
});
