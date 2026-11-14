import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Test-only helper (node:fs): which top-level message namespaces can client
// components reached from some route files read? Follows relative and "@/"
// imports through src/ and reads `useTranslations` calls. A root translator
// (`useTranslations()`) is resolved through its literal keys; anything it
// cannot resolve is reported as `unresolved`, so a scope test fails loudly
// instead of shipping a screen with missing messages.

const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

export type MessageUsage = { namespaces: Set<string>; unresolved: string[] };

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.(tsx?|mts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function resolveImport(srcRoot: string, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(srcRoot, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g;
const NAMED_RE = /useTranslations\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
const ROOT_RE = /(?:const|let)\s+(\w+)\s*=\s*useTranslations\(\s*\)/g;
const DYNAMIC_RE = /useTranslations\(\s*[^"'`)\s]/g;

function readUsage(file: string, source: string, usage: MessageUsage) {
  for (const match of source.matchAll(NAMED_RE)) {
    if (match[1]) usage.namespaces.add(match[1]);
  }
  for (const match of source.matchAll(DYNAMIC_RE)) {
    usage.unresolved.push(`${file}: ${match[0]}`);
  }
  for (const match of source.matchAll(ROOT_RE)) {
    const name = match[1] ?? "";
    const call = new RegExp(`\\b${name}(?:\\.(?:rich|markup|raw|has))?\\(\\s*([^)]*)`, "g");
    for (const use of source.matchAll(call)) {
      // "nav.floorNavigation" → the parent path "nav".
      const literal = /^["']([A-Za-z0-9_.]+)\.[A-Za-z0-9_]+["']/.exec(use[1] ?? "");
      if (literal?.[1]) usage.namespaces.add(literal[1]);
      else usage.unresolved.push(`${file}: ${name}(${use[1]}`);
    }
  }
}

/** Drops paths already covered by an ancestor ("orders" covers "orders.form"); sorted. */
export function minimalPaths(paths: Iterable<string>): string[] {
  const all = [...new Set(paths)].sort();
  return all.filter((p) => !all.some((other) => other !== p && p.startsWith(`${other}.`)));
}

/**
 * Message paths ("namespace" or "namespace.sub") used by everything reachable
 * from `entries` (files or folders).
 */
export function messageUsage(srcRoot: string, entries: string[]): MessageUsage {
  const usage: MessageUsage = { namespaces: new Set(), unresolved: [] };
  const seen = new Set<string>();
  const queue = entries.flatMap((entry) =>
    statSync(entry).isDirectory() ? filesUnder(entry) : [entry],
  );
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    readUsage(path.relative(srcRoot, file), source, usage);
    for (const match of source.matchAll(IMPORT_RE)) {
      const target = resolveImport(srcRoot, file, match[1] ?? "");
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return usage;
}
