// Client-side text matching for pickers: case- and diacritic-insensitive
// (č→c, đ→d …), every typed word must occur somewhere in the text.

export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function matchesAllWords(text: string, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldText(text);
  return words.every((word) => haystack.includes(word));
}
