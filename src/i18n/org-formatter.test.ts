import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D-063: server code formats in the organization's time zone. `getFormatter()`
// uses the request config, whose zone is a fixed fallback (the config cannot
// read the session), so it would show every firm's times in Europe/Sarajevo.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("server formatting in the organization's zone", () => {
  it("never calls getFormatter() from next-intl/server", () => {
    const offenders = sourceFiles("src").filter((file) =>
      /import\s*\{[^}]*\bgetFormatter\b[^}]*\}\s*from\s*"next-intl\/server"/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("wraps the app and floor shells in the organization's zone", () => {
    for (const layout of ["src/app/(app)/layout.tsx", "src/app/(floor)/layout.tsx"]) {
      expect(readFileSync(layout, "utf8")).toContain(
        "<OrgTimeZoneProvider timeZone={member.organization.timezone}>",
      );
    }
  });
});
