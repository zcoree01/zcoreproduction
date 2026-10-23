// Two-letter initials for avatars: first + last word, or first two letters.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const letters =
    parts.length > 1 ? [parts[0]?.[0], parts.at(-1)?.[0]] : [parts[0]?.[0], parts[0]?.[1]];
  return letters.filter(Boolean).join("").toLocaleUpperCase("bs");
}
